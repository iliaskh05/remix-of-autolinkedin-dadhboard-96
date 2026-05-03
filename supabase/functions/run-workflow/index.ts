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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || supabaseKey;

    const body = await req.json().catch(() => ({}));
    const autoPublish = body.autoPublish ?? false;

    console.log("=== Starting LinkedIn Post Workflow ===");

    // Step 1: Scrape news
    console.log("Step 1: Scraping commodity news...");
    const scrapeRes = await fetch(`${supabaseUrl}/functions/v1/scrape-news`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const scrapeData = await scrapeRes.json();
    if (!scrapeData.success) {
      throw new Error(`Scraping failed: ${scrapeData.error}`);
    }

    // Step 2: Generate post
    console.log("Step 2: Generating LinkedIn post...");
    const postRes = await fetch(`${supabaseUrl}/functions/v1/generate-post`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newsMarkdown: scrapeData.markdown }),
    });
    const postData = await postRes.json();
    if (!postData.success) {
      throw new Error(`Post generation failed: ${postData.error}`);
    }

    // Step 3: Generate image
    console.log("Step 3: Generating image...");
    let imageUrl = null;
    try {
      const imgRes = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: postData.imagePrompt, bottomMarginPercent: 14 }),
      });
      const imgData = await imgRes.json();
      if (imgData.success) {
        imageUrl = imgData.imageUrl;
      } else {
        console.warn("Image generation failed, continuing without image:", imgData.error);
      }
    } catch (imgErr) {
      console.warn("Image generation error, continuing without image:", imgErr);
    }

    // Step 4: Save to database
    console.log("Step 4: Saving post to database...");
    const { data: savedPost, error: insertError } = await supabase.from("posts").insert({
      title: postData.title,
      content: postData.content,
      news_summary: postData.newsSummary,
      image_url: imageUrl,
      status: autoPublish ? "generating" : "ready",
    }).select().single();

    if (insertError) {
      throw new Error(`Failed to save post: ${insertError.message}`);
    }

    // Step 5: Auto-publish if requested
    if (autoPublish && savedPost) {
      console.log("Step 5: Publishing to LinkedIn...");
      try {
        const publishRes = await fetch(`${supabaseUrl}/functions/v1/publish-linkedin`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ postId: savedPost.id }),
        });
        const publishData = await publishRes.json();
        if (!publishData.success) {
          console.error("Auto-publish failed:", publishData.error);
          await supabase.from("posts").update({ status: "ready" }).eq("id", savedPost.id);
        }
      } catch (pubErr) {
        console.error("Auto-publish error:", pubErr);
        await supabase.from("posts").update({ status: "ready" }).eq("id", savedPost.id);
      }
    }

    console.log("=== Workflow completed successfully ===");
    return new Response(
      JSON.stringify({ success: true, post: savedPost }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Workflow error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Workflow failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
