/**
 * OpenAI direct chat completions for write_post structured output (BYOK).
 */
import { WRITE_POST_TOOL, parseWritePostToolCall, type WritePostResult } from "./textPrompt.ts";

export async function generateWritePostWithOpenAI(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<WritePostResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
    if (res.status === 401) throw new Error("OpenAI API key is invalid.");
    if (res.status === 429) throw new Error("OpenAI rate limit exceeded.");
    throw new Error(`OpenAI upstream error [${res.status}]: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) throw new Error("AI returned no structured data");
  return parseWritePostToolCall(tc.function.arguments);
}
