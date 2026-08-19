// Ambient typings so the IDE/TypeScript can resolve Deno URL imports and the
// Deno global inside supabase/functions without requiring the Deno LSP.
// These files still run on the Deno Edge Runtime at deploy time.

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare module "npm:@google/generative-ai" {
  export enum FunctionCallingMode {
    ANY = "ANY",
  }

  export type Part =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

  export type FunctionDeclaration = {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };

  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: Record<string, unknown>): GenerativeModel;
  }

  export class GenerativeModel {
    generateContent(input: unknown): Promise<{ response: GenerateContentResponse }>;
  }

  export type GenerationConfig = {
    responseModalities?: string[];
    imageConfig?: Record<string, string>;
  };

  export class GenerateContentResponse {
    functionCalls(): Array<{ name: string; args: Record<string, unknown> }> | undefined;
    get candidates(): Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> | undefined;
  }
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  // Minimal surface used by our Edge Functions. Full types live in the Deno runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SupabaseClient = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: Record<string, unknown>): any;
}
