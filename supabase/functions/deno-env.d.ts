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

declare module "https://esm.sh/@supabase/supabase-js@2" {
  // Minimal surface used by our Edge Functions. Full types live in the Deno runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SupabaseClient = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: Record<string, unknown>): any;
}
