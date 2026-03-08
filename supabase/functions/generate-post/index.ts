import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { newsMarkdown } = await req.json();
    if (!newsMarkdown) {
      return new Response(
        JSON.stringify({ success: false, error: "newsMarkdown is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating LinkedIn post from news...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a professional commodity market analyst and LinkedIn content creator. 
Your task is to analyze the latest commodity market news and create an engaging LinkedIn post.

Rules:
- Write in a professional but engaging tone
- Include key market insights and trends
- Add relevant hashtags (5-7)
- Keep the post between 150-300 words
- Use emojis sparingly but effectively
- Include a call-to-action or question to boost engagement
- Focus on the most impactful news items

Return a JSON object with these fields:
- title: A short title summarizing the main theme (max 10 words)
- content: The full LinkedIn post text
- newsSummary: A brief 2-3 sentence summary of the key news analyzed
- imagePrompt: A description for generating a professional image to accompany this post (describe a business/finance themed image that relates to the commodity discussed)`
          },
          {
            role: "user",
            content: `Here are the latest commodity market news from Barchart:\n\n${newsMarkdown.substring(0, 8000)}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_linkedin_post",
              description: "Create a structured LinkedIn post from commodity news analysis",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short title for the post" },
                  content: { type: "string", description: "Full LinkedIn post text with hashtags" },
                  newsSummary: { type: "string", description: "Brief summary of analyzed news" },
                  imagePrompt: { type: "string", description: "Image generation prompt for the post" }
                },
                required: ["title", "content", "newsSummary", "imagePrompt"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "create_linkedin_post" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Payment required. Please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ success: false, error: "AI generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.error("No tool call in response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ success: false, error: "AI did not return structured data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const postData = JSON.parse(toolCall.function.arguments);
    console.log("Post generated successfully:", postData.title);

    return new Response(
      JSON.stringify({ success: true, ...postData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating post:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Failed to generate post" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
