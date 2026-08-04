// Cron-triggered: publishes posts whose status='scheduled' and scheduled_at <= now().
// Distinct from `run-schedules` (which generates new posts from recurring recipes)
// and from `publish-linkedin` (which publishes a single post for a logged-in user).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { fetchWithRetry } from "../_shared/httpRetry.ts";
import type { AppSupabaseClient, PostRow } from "../_shared/types.ts";

type PublishResult = {
  id: string;
  ok: boolean;
  error?: string;
  linkedinPostId?: string | null;
};

async function claimPost(supabase: AppSupabaseClient, postId: string): Promise<boolean> {
  // Atomic claim: only one cron worker can flip scheduled → generating.
  // Prevents double-publish if two cron ticks overlap.
  const { data, error } = await supabase
    .from("posts")
    .update({ status: "generating" })
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

async function publishOne(supabase: AppSupabaseClient, post: PostRow): Promise<PublishResult> {
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
    // Keep as scheduled so a later reconnect + cron tick can retry, but mark
    // failed when the account is simply not connected at all.
    await supabase.from("posts").update({ status: "failed" }).eq("id", post.id);
    return { id: post.id, ok: false, error: "LinkedIn not connected" };
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    // Revert to scheduled so the user can reconnect and the post still fires.
    await supabase.from("posts").update({ status: "scheduled" }).eq("id", post.id);
    return { id: post.id, ok: false, error: "LinkedIn token expired" };
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
    await supabase
      .from("posts")
      .update({ status: invalidToken ? "scheduled" : "failed" })
      .eq("id", post.id);
    return {
      id: post.id,
      ok: false,
      error: invalidToken
        ? "LinkedIn token invalid — post kept scheduled for retry after reconnect"
        : `LinkedIn a refusé la publication (code ${liRes.status}).`,
    };
  }

  const liData = await liRes.json();
  await supabase.from("posts").update({
    status: "published",
    published_at: new Date().toISOString(),
    linkedin_post_id: liData.id || null,
  }).eq("id", post.id);

  return { id: post.id, ok: true, linkedinPostId: liData.id || null };
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
    // Intended for pg_cron (via pg_net), not end-user calls.
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (cronSecret) {
      if (req.headers.get("x-cron-secret") !== cronSecret) {
        return json(401, { success: false, error: "Unauthorized" });
      }
    } else {
      console.warn(
        "[publish-scheduled-posts] CRON_SECRET is not configured — this endpoint is currently callable by anyone. " +
          "Set the CRON_SECRET secret and send it as the 'x-cron-secret' header from your cron job to secure it.",
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: due, error } = await supabase
      .from("posts")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (error) throw error;

    const results: PublishResult[] = [];
    for (const post of (due ?? []) as PostRow[]) {
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
