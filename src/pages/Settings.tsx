import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Loader2, ExternalLink, Link as LinkIcon, CheckCircle, XCircle,
  AlertTriangle, Plus, Trash2, Globe, Hash,
} from "lucide-react";
import { POST_MODELS, IMAGE_MODELS } from "@/lib/ai-models";

type UserSettings = {
  linkedin_client_id: string | null;
  linkedin_client_secret: string | null;
  linkedin_access_token: string | null;
  linkedin_token_expires_at: string | null;
  linkedin_person_urn: string | null;
  linkedin_organization_id: string | null;
  post_model: string;
  image_model: string;
  use_byok: boolean;
  openai_api_key: string | null;
  gemini_api_key: string | null;
  firecrawl_api_key: string | null;
  tone_instructions: string | null;
};

const Settings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState<UserSettings | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [newSource, setNewSource] = useState<{ type: "url" | "keyword"; value: string; label: string }>({
    type: "url", value: "", label: "",
  });

  // Listen for OAuth popup result
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "linkedin-oauth-result") return;
      setIsConnecting(false);
      if (event.data.success) {
        qc.invalidateQueries({ queryKey: ["user_settings"] });
        toast({ title: "LinkedIn connected" });
      } else {
        toast({ title: "Connection failed", description: event.data.error, variant: "destructive" });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc, toast]);

  const { isLoading } = useQuery({
    queryKey: ["user_settings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      // Auto-create row if missing (e.g. user signed up before trigger existed)
      if (!data) {
        const { data: created } = await supabase.from("user_settings").insert({ user_id: user!.id }).select().single();
        setS(created as UserSettings);
        return created;
      }
      setS(data as UserSettings);
      return data;
    },
  });

  const { data: sources } = useQuery({
    queryKey: ["content_sources", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("content_sources").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!s || !user) return;
      const { error } = await supabase.from("user_settings").update({
        linkedin_client_id: s.linkedin_client_id,
        linkedin_client_secret: s.linkedin_client_secret,
        linkedin_organization_id: s.linkedin_organization_id,
        post_model: s.post_model,
        image_model: s.image_model,
        use_byok: s.use_byok,
        openai_api_key: s.openai_api_key,
        gemini_api_key: s.gemini_api_key,
        firecrawl_api_key: s.firecrawl_api_key,
        tone_instructions: s.tone_instructions,
      }).eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["user_settings"] });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addSource = useMutation({
    mutationFn: async () => {
      if (!user || !newSource.value.trim()) return;
      const { error } = await supabase.from("content_sources").insert({
        user_id: user.id,
        source_type: newSource.type,
        value: newSource.value.trim(),
        label: newSource.label.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewSource({ type: newSource.type, value: "", label: "" });
      qc.invalidateQueries({ queryKey: ["content_sources"] });
    },
  });

  const deleteSource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("content_sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content_sources"] }),
  });

  const toggleSource = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("content_sources").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content_sources"] }),
  });

  const handleConnectLinkedIn = async () => {
    if (!s?.linkedin_client_id || !s?.linkedin_client_secret) {
      toast({ title: "LinkedIn app credentials required", description: "Save your Client ID & Secret first.", variant: "destructive" });
      return;
    }
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/linkedin/callback`;
      const { data, error } = await supabase.functions.invoke("linkedin-oauth", {
        body: { action: "get_auth_url", redirectUri },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      const popup = window.open(data.authUrl, "linkedin-oauth", "popup=yes,width=720,height=820");
      if (!popup) {
        setIsConnecting(false);
        throw new Error("Popup blocked. Allow popups and try again.");
      }
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
      setIsConnecting(false);
    }
  };

  if (isLoading || !s) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const expiresAt = s.linkedin_token_expires_at ? new Date(s.linkedin_token_expires_at) : null;
  const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;
  const hasLinkedIn = !!(s.linkedin_access_token && s.linkedin_person_urn);
  const isConnected = hasLinkedIn && !isExpired;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your LinkedIn page, content sources, and AI models.</p>
      </div>

      {/* LinkedIn App Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" /> LinkedIn App Credentials
          </CardTitle>
          <CardDescription>
            Create a LinkedIn app at{" "}
            <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">LinkedIn Developers</a>.
            Add this redirect URL: <code className="bg-muted px-1 rounded text-xs">{window.location.origin}/linkedin/callback</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Client ID</Label>
            <Input value={s.linkedin_client_id || ""} onChange={(e) => setS({ ...s, linkedin_client_id: e.target.value })} placeholder="77abc123..." />
          </div>
          <div className="space-y-1">
            <Label>Client Secret</Label>
            <Input type="password" value={s.linkedin_client_secret || ""} onChange={(e) => setS({ ...s, linkedin_client_secret: e.target.value })} placeholder="WPL_AP1..." />
          </div>
          <div className="space-y-1">
            <Label>LinkedIn Page (Organization) ID — optional</Label>
            <Input value={s.linkedin_organization_id || ""} onChange={(e) => setS({ ...s, linkedin_organization_id: e.target.value })} placeholder="123456789 (leave empty to post on personal profile)" />
            <p className="text-xs text-muted-foreground">Numeric ID only. Posting to a Page requires LinkedIn MDP approval on your app.</p>
          </div>
        </CardContent>
      </Card>

      {/* Connect LinkedIn */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Connect LinkedIn Account
            <div className="ml-auto">
              {isConnected ? (
                <Badge className="gap-1 bg-green-500/15 text-green-600 border border-green-500/30"><CheckCircle className="h-3 w-3" /> Connected</Badge>
              ) : isExpired ? (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Expired</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><XCircle className="h-3 w-3" /> Not connected</Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isConnected && (
            <p className="text-xs text-muted-foreground mb-3">Person URN: <code>{s.linkedin_person_urn}</code> · expires {expiresAt?.toLocaleDateString()}</p>
          )}
          <Button onClick={handleConnectLinkedIn} disabled={isConnecting} className="w-full">
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
            {isConnected ? "Reconnect LinkedIn" : "Connect with LinkedIn"}
          </Button>
        </CardContent>
      </Card>

      {/* Content Sources */}
      <Card>
        <CardHeader>
          <CardTitle>Content Sources</CardTitle>
          <CardDescription>URLs and keywords used as inspiration to generate your posts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Select value={newSource.type} onValueChange={(v: "url" | "keyword") => setNewSource({ ...newSource, type: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="keyword">Keyword</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={newSource.type === "url" ? "https://example.com/news" : "AI, fintech, climate..."}
              value={newSource.value}
              onChange={(e) => setNewSource({ ...newSource, value: e.target.value })}
            />
            <Input placeholder="Label (optional)" value={newSource.label} onChange={(e) => setNewSource({ ...newSource, label: e.target.value })} className="w-40" />
            <Button onClick={() => addSource.mutate()} disabled={!newSource.value.trim()}><Plus className="h-4 w-4" /></Button>
          </div>

          <div className="space-y-2">
            {sources?.length ? sources.map((src) => (
              <div key={src.id} className="flex items-center gap-3 p-3 rounded-lg border">
                {src.source_type === "url" ? <Globe className="h-4 w-4 text-muted-foreground" /> : <Hash className="h-4 w-4 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{src.label || src.value}</p>
                  {src.label && <p className="text-xs text-muted-foreground truncate">{src.value}</p>}
                </div>
                <Switch checked={src.enabled} onCheckedChange={(v) => toggleSource.mutate({ id: src.id, enabled: v })} />
                <Button variant="ghost" size="icon" onClick={() => deleteSource.mutate(src.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">No sources yet. Add URLs or keywords above.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Models */}
      <Card>
        <CardHeader>
          <CardTitle>AI Models</CardTitle>
          <CardDescription>Choose which AI model to use per feature.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Post (text) generation model</Label>
            <Select value={s.post_model} onValueChange={(v) => setS({ ...s, post_model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {POST_MODELS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Image generation model</Label>
            <Select value={s.image_model} onValueChange={(v) => setS({ ...s, image_model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tone & instructions (optional)</Label>
            <Textarea
              value={s.tone_instructions || ""}
              onChange={(e) => setS({ ...s, tone_instructions: e.target.value })}
              placeholder="E.g. Professional, witty, focus on B2B SaaS founders. Always end with a question."
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div>
              <Label>Bring your own API keys (BYOK)</Label>
              <p className="text-xs text-muted-foreground">Utilise tes propres clés au lieu de Lovable AI / connecteurs partagés. Tu ne paies que ce que tu consommes chez chaque fournisseur.</p>
            </div>
            <Switch checked={s.use_byok} onCheckedChange={(v) => setS({ ...s, use_byok: v })} />
          </div>
          {s.use_byok && (
            <div className="space-y-4 pl-4 border-l-2 border-primary/30">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Génération de texte</p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>OpenAI API Key</Label>
                    <Input type="password" autoComplete="off" value={s.openai_api_key || ""} onChange={(e) => setS({ ...s, openai_api_key: e.target.value })} placeholder="sk-..." />
                    <p className="text-[11px] text-muted-foreground">
                      Couvre tous les modèles GPT-5 (gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.2). Récupère ta clé sur{" "}
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-primary hover:underline">platform.openai.com</a>.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label>Google Gemini API Key</Label>
                    <Input type="password" autoComplete="off" value={s.gemini_api_key || ""} onChange={(e) => setS({ ...s, gemini_api_key: e.target.value })} placeholder="AIza..." />
                    <p className="text-[11px] text-muted-foreground">
                      Couvre tous les modèles Gemini texte ET image (2.5 Pro/Flash/Lite, 3 Flash/Pro Preview, Nano Banana 1 & 2, Gemini 3 Pro Image). Récupère ta clé sur{" "}
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">aistudio.google.com</a>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sources de contenu (web scraping & search)</p>
                <div className="space-y-1">
                  <Label>Firecrawl API Key</Label>
                  <Input type="password" autoComplete="off" value={s.firecrawl_api_key || ""} onChange={(e) => setS({ ...s, firecrawl_api_key: e.target.value })} placeholder="fc-..." />
                  <p className="text-[11px] text-muted-foreground">
                    Utilisée pour scraper les URLs et faire les recherches web (mots-clés) dans tes Content Sources. Récupère ta clé sur{" "}
                    <a href="https://www.firecrawl.dev/app/api-keys" target="_blank" rel="noreferrer" className="text-primary hover:underline">firecrawl.dev</a>.
                  </p>
                </div>
              </div>

              <div className="rounded-md bg-muted/50 p-3 text-[11px] text-muted-foreground">
                💡 Tu peux ne renseigner que certaines clés. Pour celles qui sont vides, l'app retombe automatiquement sur les services partagés Lovable.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full" size="lg">
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save All Settings
      </Button>
    </div>
  );
};

export default Settings;
