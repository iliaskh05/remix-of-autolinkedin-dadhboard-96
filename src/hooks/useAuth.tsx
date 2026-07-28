import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type AuthCtx = { user: User | null; session: Session | null; loading: boolean };
const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    // `onAuthStateChange` fires synchronously with the current session right
    // after subscribing (event `INITIAL_SESSION`), then again on every
    // subsequent change. Relying on this single source of truth — instead of
    // also calling `getSession()` in parallel — avoids a race where the two
    // independent async resolutions could overwrite each other with a stale
    // value (e.g. a sign-out in another tab landing before the initial
    // `getSession()` promise resolves).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      // Prevent stale data (from a previous user, on a shared device/tab)
      // from leaking into the next session.
      if (event === "SIGNED_OUT") {
        queryClient.clear();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <Ctx.Provider value={{ user: session?.user ?? null, session, loading }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
