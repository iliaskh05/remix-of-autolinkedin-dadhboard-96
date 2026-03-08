import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { postId } = await req.json();
    if (!postId) {
      return new Response(
        JSON.stringify({ success: false, error: "postId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get post
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (postError || !post) {
      return new Response(
        JSON.stringify({ success: false, error: "Post not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get LinkedIn credentials from settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["linkedin_access_token", "linkedin_person_urn", "linkedin_organization_id"]);

    const settingsMap: Record<string, string> = {};
    settings?.forEach((s: { key: string; value: string }) => {
      settingsMap[s.key] = s.value;
    });

    const accessToken = settingsMap.linkedin_access_token;
    const personUrn = settingsMap.linkedin_person_urn;
    const organizationId = settingsMap.linkedin_organization_id;

    if (!accessToken || !personUrn) {
      return new Response(
        JSON.stringify({ success: false, error: "LinkedIn credentials not configured. Go to Settings to add them." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use organization URN if configured, otherwise fall back to person URN
    const authorUrn = organizationId
      ? `urn:li:organization:${organizationId}`
      : personUrn;

    // If we have an image, upload it to LinkedIn first
    let imageAsset: string | null = null;
    if (post.image_url && !post.image_url.startsWith("data:")) {
      try {
        // Register upload
        const registerRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
              owner: authorUrn,
              serviceRelationships: [
                { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }
              ]
            }
          }),
        });

        if (registerRes.ok) {
          const registerData = await registerRes.json();
          const uploadUrl = registerData.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
          imageAsset = registerData.value?.asset;

          if (uploadUrl) {
            const imgResponse = await fetch(post.image_url);
            const imgBlob = await imgResponse.blob();
            await fetch(uploadUrl, {
              method: "PUT",
              headers: { Authorization: `Bearer ${accessToken}` },
              body: imgBlob,
            });
          }
        }
      } catch (imgErr) {
        console.error("Image upload to LinkedIn failed:", imgErr);
      }
    }

    // Create the post
    const postBody: Record<string, unknown> = {
      author: personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: post.content },
          shareMediaCategory: imageAsset ? "IMAGE" : "NONE",
          ...(imageAsset ? {
            media: [{
              status: "READY",
              media: imageAsset,
            }]
          } : {})
        }
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
      }
    };

    const linkedinRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(postBody),
    });

    if (!linkedinRes.ok) {
      const errText = await linkedinRes.text();
      console.error("LinkedIn API error:", linkedinRes.status, errText);
      
      await supabase.from("posts").update({ status: "failed" }).eq("id", postId);
      
      return new Response(
        JSON.stringify({ success: false, error: `LinkedIn API error [${linkedinRes.status}]: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const linkedinData = await linkedinRes.json();

    await supabase.from("posts").update({
      status: "published",
      published_at: new Date().toISOString(),
      linkedin_post_id: linkedinData.id || null,
    }).eq("id", postId);

    console.log("Post published to LinkedIn:", linkedinData.id);
    return new Response(
      JSON.stringify({ success: true, linkedinPostId: linkedinData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error publishing:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Failed to publish" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
