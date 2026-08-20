/**
 * Lovable AI Gateway client (OpenAI-compatible chat completions).
 * Used ONLY when BYOK is disabled.
 */
import { WRITE_POST_TOOL, parseWritePostToolCall, type WritePostResult } from "./textPrompt.ts";

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type LovableUpstreamError = {
  status: number;
  message: string;
};

function statusMessage(status: number, body: string): string {
  if (status === 402) return "Lovable AI credits are exhausted.";
  if (status === 429) return "Lovable rate limit exceeded.";
  if (status === 401) return "Lovable API key is invalid.";
  return `Lovable upstream error [${status}]: ${body.slice(0, 200)}`;
}

export async function generateWritePostWithLovable(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<WritePostResult> {
  const res = await fetch(LOVABLE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      tools: [WRITE_POST_TOOL],
      tool_choice: { type: "function", function: { name: "write_post" } },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(statusMessage(res.status, text));
  }

  const data = await res.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) throw new Error("AI returned no structured data");
  return parseWritePostToolCall(tc.function.arguments);
}

export type LovableImageResult = {
  base64: string;
  mimeType: string;
};

export async function generateImageWithLovable(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  inputImageUrl?: string;
}): Promise<LovableImageResult | LovableUpstreamError> {
  const userContent: unknown = opts.inputImageUrl
    ? [
      { type: "text", text: `Edit this image following these instructions: ${opts.prompt}` },
      { type: "image_url", image_url: { url: opts.inputImageUrl } },
    ]
    : opts.prompt;

  try {
    const response = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: userContent }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Lovable image error:", response.status, text.slice(0, 300));
      return { status: response.status, message: statusMessage(response.status, text) };
    }

    const data = await response.json();
    const imageUrl: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      return { status: 502, message: "Lovable returned no image data" };
    }

    const dataUrlMatch = imageUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      return { mimeType: dataUrlMatch[1], base64: dataUrlMatch[2] };
    }

    // Rare: remote URL — fetch and encode (only data URLs are typical).
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { status: 502, message: "Could not download Lovable image" };
    const mimeType = imgRes.headers.get("content-type")?.split(";")[0] || "image/png";
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { base64: btoa(binary), mimeType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/429|quota|rate/i.test(message)) return { status: 429, message };
    if (/402|credit/i.test(message)) return { status: 402, message };
    console.error("Lovable image SDK error:", message);
    return { status: 502, message };
  }
}
