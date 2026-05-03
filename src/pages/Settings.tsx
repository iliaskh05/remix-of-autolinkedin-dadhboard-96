import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save, Loader2, ExternalLink, Key, User, Link as LinkIcon, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const settingsFields = [
  {
    key: "linkedin_access_token",
    label: "LinkedIn Access Token",
    description: "Your LinkedIn API access token for posting",
    icon: Key,
    type: "password" as const,
  },
  {
    key: "linkedin_person_urn",
    label: "LinkedIn Person URN",
    description: 'Your LinkedIn person URN (e.g., urn:li:person:ABC123)',
    icon: User,
    type: "text" as const,
  },
  {
    key: "linkedin_organization_id",
    label: "LinkedIn Organization ID (Page)",
    description: "L'ID numérique de votre page LinkedIn (ex: 123456789). Si renseigné, les posts seront publiés sur la page.",
    icon: ExternalLink,
    type: "text" as const,
  },
];

const Settings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const handleLinkedInOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "linkedin-oauth-result") return;

      setIsConnecting(false);

      if (event.data.success) {
        queryClient.invalidateQueries({ queryKey: ["settings"] });
        toast({
          title: "LinkedIn connected",
          description: "Your LinkedIn session has been refreshed.",
        });
        return;
      }

      toast({
        title: "Connection failed",
        description: event.data.error || "LinkedIn authorization failed.",
        variant: "destructive",
      });
    };

    window.addEventListener("message", handleLinkedInOAuthMessage);
    return () => window.removeEventListener("message", handleLinkedInOAuthMessage);
  }, [queryClient, toast]);

  const { isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value");
      if (error) throw error;
      const map: Record<string, string> = {};
      data?.forEach((s) => { map[s.key] = s.value; });
      setValues(map);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const field of settingsFields) {
        if (values[field.key] !== undefined) {
          const { error } = await supabase
            .from("app_settings")
            .upsert({ key: field.key, value: values[field.key] }, { onConflict: "key" });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Your credentials have been updated." });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleConnectLinkedIn = async () => {
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/linkedin/callback`;
      const { data, error } = await supabase.functions.invoke("linkedin-oauth", {
        body: { action: "get_auth_url", redirectUri },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      const popup = window.open(
        data.authUrl,
        "linkedin-oauth",
        "popup=yes,width=720,height=820"
      );

      if (!popup) {
        setIsConnecting(false);
        throw new Error("Popup blocked. Please allow popups for this site and try again.");
      }
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to start OAuth", variant: "destructive" });
      setIsConnecting(false);
    }
  };

  const hasCredentials = values.linkedin_access_token && values.linkedin_person_urn;
  const expiresAtStr = values.linkedin_access_token_expires_at;
  const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;
  const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;
  const isConnected = hasCredentials && !isExpired;

  const StatusBadge = () => {
    if (!hasCredentials) {
      return (
        <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground">
          <XCircle className="h-3 w-3" /> Not connected
        </Badge>
      );
    }
    if (isExpired) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> Token expired
        </Badge>
      );
    }
    return (
      <Badge className="gap-1 bg-green-500/15 text-green-600 hover:bg-green-500/20 border border-green-500/30">
        <CheckCircle className="h-3 w-3" /> Connected
      </Badge>
    );
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your LinkedIn credentials and preferences
        </p>
      </div>

      {/* OAuth Connect Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Connect LinkedIn Account
            <div className="ml-auto"><StatusBadge /></div>
          </CardTitle>
          <CardDescription>
            The easiest way to connect — authorize via LinkedIn OAuth and we'll automatically get your access token and Person URN.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">LinkedIn Connected</p>
                <p className="text-xs text-muted-foreground">Person URN: {values.linkedin_person_urn}</p>
                {expiresAt && (
                  <p className="text-xs text-muted-foreground">Token valid until {expiresAt.toLocaleString()}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleConnectLinkedIn} disabled={isConnecting}>
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconnect"}
              </Button>
            </div>
          ) : hasCredentials && isExpired ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Token expired</p>
                <p className="text-xs text-muted-foreground">Reconnect your LinkedIn account to publish again.</p>
              </div>
              <Button variant="default" size="sm" onClick={handleConnectLinkedIn} disabled={isConnecting}>
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconnect"}
              </Button>
            </div>
          ) : (
            <Button onClick={handleConnectLinkedIn} disabled={isConnecting} className="w-full">
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              Connect with LinkedIn
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Manual Credentials Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Manual Credentials
            <div className="ml-auto"><StatusBadge /></div>
          </CardTitle>
          <CardDescription>
            Or enter your credentials manually if you already have an access token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {settingsFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key} className="flex items-center gap-2">
                    <field.icon className="h-4 w-4 text-muted-foreground" />
                    {field.label}
                  </Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.description}
                  />
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                </div>
              ))}

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="w-full"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Important: LinkedIn App Setup</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>Before connecting, make sure your LinkedIn app is configured correctly:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">LinkedIn Developers</a> and select your app</li>
            <li>Under <strong>Products</strong>, request access to <strong>Share on LinkedIn</strong> and <strong>Sign In with LinkedIn using OpenID Connect</strong></li>
            <li>Under <strong>Auth → OAuth 2.0 settings</strong>, add this redirect URL:
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs block mt-1">{window.location.origin}/linkedin/callback</code>
            </li>
            <li>Then click <strong>"Connect with LinkedIn"</strong> above</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;
