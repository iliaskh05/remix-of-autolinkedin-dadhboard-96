import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LinkedInCallback = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const notifyParentAndClose = (payload: { success: boolean; error?: string }) => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "linkedin-oauth-result", ...payload }, window.location.origin);
        window.close();
        return true;
      }

      return false;
    };

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      notifyParentAndClose({
        success: false,
        error: params.get("error_description") || "Authorization was denied.",
      });
      setStatus("error");
      setMessage(params.get("error_description") || "Authorization was denied.");
      return;
    }

    if (!code) {
      notifyParentAndClose({ success: false, error: "No authorization code received." });
      setStatus("error");
      setMessage("No authorization code received.");
      return;
    }

    const exchangeCode = async () => {
      try {
        // Wait for the session to be restored from localStorage before invoking
        // the edge function (popup window may not have it ready instantly).
        let { data: sessionData } = await supabase.auth.getSession();
        for (let i = 0; i < 20 && !sessionData.session; i++) {
          await new Promise((r) => setTimeout(r, 100));
          ({ data: sessionData } = await supabase.auth.getSession());
        }
        if (!sessionData.session) {
          throw new Error("You are not signed in. Please log in and reconnect LinkedIn from Settings.");
        }

        const { data, error: fnError } = await supabase.functions.invoke("linkedin-oauth", {
          body: {
            action: "exchange_code",
            code,
            redirectUri: `${window.location.origin}/linkedin/callback`,
          },
        });

        if (fnError) throw fnError;
        if (!data.success) throw new Error(data.error);

        if (notifyParentAndClose({ success: true })) {
          return;
        }

        setStatus("success");
        setMessage(`Connected successfully! Person URN: ${data.personUrn}`);
        
        // Redirect to settings after 2 seconds
        setTimeout(() => navigate("/settings"), 2000);
      } catch (err) {
        notifyParentAndClose({
          success: false,
          error: err instanceof Error ? err.message : "Failed to exchange code",
        });
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to exchange code");
      }
    };

    exchangeCode();
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <p className="text-lg font-medium">Connecting to LinkedIn...</p>
              <p className="text-sm text-muted-foreground">Exchanging authorization code for access token</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <p className="text-lg font-medium">LinkedIn Connected!</p>
              <p className="text-sm text-muted-foreground">{message}</p>
              <p className="text-xs text-muted-foreground">Redirecting to settings...</p>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <p className="text-lg font-medium">Connection Failed</p>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button onClick={() => navigate("/settings")} className="mt-4">
                Back to Settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LinkedInCallback;
