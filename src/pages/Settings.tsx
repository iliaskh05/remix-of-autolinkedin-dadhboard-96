import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save, Loader2, ExternalLink, Key, User } from "lucide-react";

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
];

const Settings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

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

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your LinkedIn credentials and preferences
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            LinkedIn API Credentials
          </CardTitle>
          <CardDescription>
            You need a LinkedIn API access token to publish posts.{" "}
            <a
              href="https://www.linkedin.com/developers/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Get your credentials <ExternalLink className="h-3 w-3" />
            </a>
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
          <CardTitle>How to get LinkedIn credentials</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">LinkedIn Developers</a> and create an app</li>
            <li>Under Products, request access to <strong>Share on LinkedIn</strong> and <strong>Sign In with LinkedIn using OpenID Connect</strong></li>
            <li>Go to the Auth tab and copy your Access Token</li>
            <li>Your Person URN can be found via the LinkedIn API: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">GET /v2/me</code> — it looks like <code className="bg-muted px-1.5 py-0.5 rounded text-xs">urn:li:person:ABC123</code></li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;
