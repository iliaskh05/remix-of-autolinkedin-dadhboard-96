// Cron-triggered worker for the `scheduled_posts` queue.
// Selects due rows (status='scheduled' AND scheduled_at <= now()), claims them
// as 'publishing', posts to LinkedIn, then marks published / failed.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { fetchWithRetry } from "../_shared/httpRetry.ts";
import type { AppSupabaseClient } from "../_shared/types.ts";

type ScheduledPostRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  image_url: string | null;
  scheduled_at: string;
  status: string;
  error_message: string | null;
  linkedin_post_id: string | null;
};

type PublishResult = {
  id: string;
  ok: boolean;
  error?: string;
  linkedinPostId?: string | null;
};

async function claimPost(supabase: AppSupabaseClient, postId: string): Promise<boolean> {
  // Atomic claim: only one worker can flip scheduled → publishing.
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ status: "publishing", error_message: null })
    .eq("id", postId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[publish-scheduled-posts] claim failed", postId, error);
    return false;
  }
  return Boolean(data?.id);
}

async function markFailed(
  supabase: AppSupabaseClient,
  postId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from("scheduled_posts")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", postId);
}

async function publishOne(
  supabase: AppSupabaseClient,
  post: ScheduledPostRow,
): Promise<PublishResult> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("linkedin_access_token, linkedin_token_expires_at, linkedin_person_urn, linkedin_organization_id")
    .eq("user_id", post.user_id)
    .maybeSingle();

  const accessToken = settings?.linkedin_access_token;
  const personUrn = settings?.linkedin_person_urn;
  const organizationId = settings?.linkedin_organization_id;
  const expiresAt = settings?.linkedin_token_expires_at;

  if (!accessToken || !personUrn) {
    const msg = "LinkedIn non connecté. Reconnecte le compte dans Paramètres.";
    await markFailed(supabase, post.id, msg);
    return { id: post.id, ok: false, error: msg };
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    const msg = "Token LinkedIn expiré. Reconnecte le compte dans Paramètres.";
    // Keep retryable: revert to scheduled so a later reconnect can succeed.
    await supabase
      .from("scheduled_posts")
      .update({ status: "scheduled", error_message: msg })
      .eq("id", post.id);
    return { id: post.id, ok: false, error: msg };
  }

  const authorUrn = organizationId
    ? `urn:li:organization:${organizationId.replace(/^urn:li:organization:/, "")}`
    : personUrn;

  let imageAsset: string | null = null;
  if (post.image_url && !post.image_url.startsWith("data:")) {
    try {
      const reg = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: authorUrn,
            serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
          },
        }),
      });
      if (reg.ok) {
        const rd = await reg.json();
        const uploadUrl = rd.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
        imageAsset = rd.value?.asset ?? null;
        if (uploadUrl) {
          const blob = await (await fetch(post.image_url)).blob();
          await fetch(uploadUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: blob,
          });
        }
      } else {
        console.warn("[publish-scheduled-posts] image register failed", post.id, reg.status, await reg.text());
      }
    } catch (e) {
      console.error("[publish-scheduled-posts] image upload failed", post.id, e);
    }
  }

  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: post.content },
        shareMediaCategory: imageAsset ? "IMAGE" : "NONE",
        ...(imageAsset ? { media: [{ status: "READY", media: imageAsset }] } : {}),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const liRes = await fetchWithRetry("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!liRes.ok) {
    const errText = await liRes.text();
    console.error("[publish-scheduled-posts] LinkedIn error", post.id, liRes.status, errText);
    const invalidToken = liRes.status === 401 && errText.includes("INVALID_ACCESS_TOKEN");
    const msg = invalidToken
      ? "Token LinkedIn invalide. Reconnecte le compte dans Paramètres."
      : `LinkedIn a refusé la publication (code ${liRes.status}).`;

    if (invalidToken) {
      await supabase
        .from("scheduled_posts")
        .update({ status: "scheduled", error_message: msg })
        .eq("id", post.id);
    } else {
      await markFailed(supabase, post.id, msg);
    }
    return { id: post.id, ok: false, error: msg };
  }

  const liData = await liRes.json();
  const linkedinPostId = (liData.id as string | undefined) || null;
  const publishedAt = new Date().toISOString();

  await supabase.from("scheduled_posts").update({
    status: "published",
    linkedin_post_id: linkedinPostId,
    published_at: publishedAt,
    error_message: null,
  }).eq("id", post.id);

  // Mirror into the historical `posts` feed so Dashboard / History stay complete.
  await supabase.from("posts").insert({
    user_id: post.user_id,
    title: post.title || post.content.slice(0, 60),
    content: post.content,
    image_url: post.image_url,
    status: "published",
    scheduled_at: post.scheduled_at,
    published_at: publishedAt,
    linkedin_post_id: linkedinPostId,
  });

  return { id: post.id, ok: true, linkedinPostId };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Prefer a dedicated cron secret. Fall back to a Bearer service-role token
    // so the endpoint can also be invoked from the Supabase dashboard / pg_net
    // with Authorization: Bearer <SERVICE_ROLE_KEY>.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const hasCronSecret = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
    const hasServiceRole = Boolean(serviceRoleKey) && bearer === serviceRoleKey;

    if (cronSecret || serviceRoleKey) {
      if (!hasCronSecret && !hasServiceRole) {
        return json(401, { success: false, error: "Unauthorized" });
      }
    } else {
      console.warn(
        "[publish-scheduled-posts] Neither CRON_SECRET nor SUPABASE_SERVICE_ROLE_KEY is usable for auth — " +
          "configure CRON_SECRET (preferred) or invoke with the service-role Bearer token.",
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: due, error } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (error) throw error;

    const results: PublishResult[] = [];
    for (const post of (due ?? []) as ScheduledPostRow[]) {
      const claimed = await claimPost(supabase, post.id);
      if (!claimed) continue;
      results.push(await publishOne(supabase, post));
    }

    return json(200, {
      success: true,
      processed: results.length,
      published: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    console.error("[publish-scheduled-posts] error", e);
    return json(500, {
      success: false,
      error: e instanceof Error ? e.message : "Failed",
    });
  }
});
