import { useState, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Wand2, Image as ImageIcon, Upload, Send, Save, Loader2,
  CalendarIcon, X, Type, RefreshCw, Linkedin, Lightbulb, Globe, Hash, Plus, BookMarked,
  Repeat, Clock, CheckCircle2, Users, MessageSquare, ChevronDown, Languages,
  Zap, ThumbsUp, MessageCircle, Share2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { loadPrefs } from "@/lib/imagePrefs";
import { isVisualBrief, summarizeVisualBrief, type VisualBrief } from "@/lib/visualBrief";
import {
  POST_TONES, POST_LENGTHS, POST_LANGUAGES, DEFAULT_POST_TONE, DEFAULT_POST_LENGTH,
  DEFAULT_POST_LANGUAGE, languageNameFor,
} from "@/lib/ai-models";
import { getSafeErrorMessage } from "@/lib/errors";
import { DAYS, computeNextRunISO } from "@/lib/scheduleUtils";
import type { Tables } from "@/integrations/supabase/types";

type ContentSource = Tables<"content_sources">;
type SourceType = "url" | "keyword" | "idea";

type Mode = "ai" | "manual";

const Composer = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  // Text
  const [textMode, setTextMode] = useState<Mode>("ai");
  const [textPrompt, setTextPrompt] = useState("");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [newHashtag, setNewHashtag] = useState("");
  // Human-in-the-loop: true once the AI produced a draft that still awaits approval.
  const [awaitingReview, setAwaitingReview] = useState(false);

  // Generation "voice" controls — all optional. By default the AI infers
  // everything from the topic alone; these are power-user overrides tucked
  // away behind "Options avancées".
  const [tone, setTone] = useState<string>(DEFAULT_POST_TONE);
  const [audience, setAudience] = useState<string>("");
  const [length, setLength] = useState<string>(DEFAULT_POST_LENGTH);
  const [language, setLanguage] = useState<string>(DEFAULT_POST_LANGUAGE);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Image
  const [imageMode, setImageMode] = useState<Mode>("ai");
  const [imagePrompt, setImagePrompt] = useState("");
  const [visualBrief, setVisualBrief] = useState<VisualBrief | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [includeImage, setIncludeImage] = useState(true);

  // Schedule (one-shot)
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState("09:00");

  // Automation (recurring)
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoName, setAutoName] = useState("");
  const [autoDays, setAutoDays] = useState<number[]>([1, 3, 5]);
  const [autoHour, setAutoHour] = useState(9);
  const [autoMinute, setAutoMinute] = useState(0);
  const [autoTz, setAutoTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris");

  // Eligibility for recurring schedule: must use AI text + (no image OR AI image). Manual text/image = static, can't re-run.
  const canAutomate = textMode === "ai" && textPrompt.trim().length > 0 && (!includeImage || imageMode === "ai");

  // Sources (per-post)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [adhocSources, setAdhocSources] = useState<{ id: string; type: "url" | "keyword" | "idea"; value: string }[]>([]);
  const [newSourceType, setNewSourceType] = useState<"url" | "keyword" | "idea">("idea");
  const [newSourceValue, setNewSourceValue] = useState("");

  const { data: savedSources } = useQuery({
    queryKey: ["content_sources", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_sources")
        .select("*")
        .eq("user_id", user!.id)
        .eq("enabled", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Load the user's default voice settings to prefill the controls — once,
  // so we never clobber the user's in-session choices on a background refetch.
  const voiceDefaultsApplied = useRef(false);
  useQuery({
    queryKey: ["user_settings_voice", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("post_tone, post_audience, post_length")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (data && !voiceDefaultsApplied.current) {
        voiceDefaultsApplied.current = true;
        if (data.post_tone) setTone(data.post_tone);
        if (data.post_audience) setAudience(data.post_audience);
        if (data.post_length) setLength(data.post_length);
      }
      return data ?? null;
    },
  });

  // (Image Studio is now a preferences editor — no image is sent over.)

  const addHashtag = () => {
    const v = newHashtag.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!v) return;
    setHashtags((p) => (p.some((h) => h.toLowerCase() === v.toLowerCase()) ? p : [...p, v]));
    setNewHashtag("");
  };

  const addAdhoc = () => {
    const v = newSourceValue.trim();
    if (!v) return;
    setAdhocSources((p) => [...p, { id: crypto.randomUUID(), type: newSourceType, value: v }]);
    setNewSourceValue("");
  };

  const [busy, setBusy] = useState<string | null>(null);

  // Ready-to-publish text = body + hashtag block. Used for preview, count & publish.
  const finalContent = useMemo(() => {
    const line = hashtags.map((h) => `#${h}`).join(" ");
    return line ? `${content.trim()}\n\n${line}` : content.trim();
  }, [content, hashtags]);

  const charCount = finalContent.length;
  const scheduledISO = useMemo(() => {
    if (!scheduleEnabled || !scheduleDate) return null;
    const [h, m] = scheduleTime.split(":").map(Number);
    const d = new Date(scheduleDate);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  }, [scheduleEnabled, scheduleDate, scheduleTime]);

  // ---- AI text ----
  const generateText = useMutation({
    mutationFn: async (mode: "create" | "improve") => {
      setBusy("text");
      const { data, error } = await supabase.functions.invoke("compose-text", {
        body: {
          prompt: textPrompt,
          currentText: mode === "improve" ? content : undefined,
          imageUrl: imageUrl && !imageUrl.startsWith("data:") ? imageUrl : undefined,
          mode,
          savedSourceIds: selectedSourceIds,
          sources: adhocSources.map(({ type, value }) => ({ type, value })),
          tone,
          audience: audience.trim() || undefined,
          length,
          language: languageNameFor(language),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      return data;
    },
    onSuccess: (d) => {
      // Prefer the structured fields; fall back to the assembled content for safety.
      setContent(d.post_body ?? d.content ?? "");
      setHashtags(Array.isArray(d.hashtags) ? d.hashtags : []);
      if (!title) setTitle(d.title);
      // Two-layer image pipeline: keep the structured visual_brief for the
      // Edge Function, and show a compact summary in the editable textarea.
      if (isVisualBrief(d.visual_brief)) {
        setVisualBrief(d.visual_brief);
        if (!imagePrompt.trim()) setImagePrompt(d.image_prompt || summarizeVisualBrief(d.visual_brief));
      } else if (d.image_prompt && !imagePrompt.trim()) {
        setVisualBrief(null);
        setImagePrompt(d.image_prompt);
      }
      setAwaitingReview(true);
      toast({ title: "Brouillon généré ✨", description: "Relis et édite avant de publier." });
    },
    onError: (e: unknown) => toast({ title: "Erreur", description: getSafeErrorMessage(e), variant: "destructive" }),
    onSettled: () => setBusy(null),
  });

  // ---- AI image ----
  const generateImage = useMutation({
    mutationFn: async (opts?: { visualBrief?: VisualBrief | null; prompt?: string }) => {
      setBusy("image");
      const prefs = loadPrefs();
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: {
          // Prefer the structured brief so the server can assemble the
          // guarded dashboard prompt. Fall back to the free-form textarea
          // if the user edited it or no brief is available.
          visualBrief: opts?.visualBrief ?? visualBrief ?? undefined,
          prompt: opts?.prompt || imagePrompt || content.substring(0, 300) || "professional LinkedIn illustration",
          inputImageUrl: imageUrl && !imageUrl.startsWith("data:") ? imageUrl : undefined,
          aspectRatio: prefs.aspectRatio,
          style: prefs.style,
          mood: prefs.mood,
          colors: prefs.colors,
          bottomMarginPercent: prefs.bottomMarginPercent,
          textOverlay: prefs.textOverlay,
          wordmark: prefs.wordmark,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed");
      return data.imageUrl as string;
    },
    onSuccess: (url) => {
      setImageUrl(url);
      toast({ title: "Image générée ✨" });
    },
    onError: (e: unknown) => toast({ title: "Erreur", description: getSafeErrorMessage(e), variant: "destructive" }),
    onSettled: () => setBusy(null),
  });

  // ---- Manual upload ----
  const uploadImage = async (file: File) => {
    if (!user) return;
    setBusy("upload");
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("post-assets").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("post-assets").getPublicUrl(path);
      setImageUrl(data.publicUrl);
      toast({ title: "Image téléversée" });
    } catch (e: unknown) {
      toast({ title: "Erreur upload", description: getSafeErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // ---- Automate (create recurring schedule from current recipe) ----
  const createSchedule = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      if (!textPrompt.trim()) throw new Error("Le prompt IA est requis pour automatiser");
      if (!autoName.trim()) throw new Error("Donne un nom au schedule");
      if (!autoDays.length) throw new Error("Choisis au moins un jour");
      const { error } = await supabase.from("schedules").insert({
        user_id: user.id,
        name: autoName.trim(),
        prompt: textPrompt,
        saved_source_ids: selectedSourceIds,
        adhoc_sources: adhocSources.map(({ type, value }) => ({ type, value })),
        days_of_week: autoDays,
        hour: autoHour,
        minute: autoMinute,
        timezone: autoTz,
        image_mode: includeImage && imageMode === "ai" ? "ai" : "none",
        image_prompt: includeImage && imageMode === "ai" ? (imagePrompt || null) : null,
        enabled: true,
        next_run_at: computeNextRunISO(autoDays, autoHour, autoMinute, autoTz),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Automatisation créée 🎯", description: "Le post sera généré et publié automatiquement." });
      setAutoOpen(false);
      navigate("/schedules");
    },
    onError: (e: unknown) => toast({ title: "Erreur", description: getSafeErrorMessage(e), variant: "destructive" }),
  });

  // ---- Save / Publish / Schedule ----
  const submit = async (action: "draft" | "publish" | "schedule") => {
    if (!user) return;
    if (!finalContent.trim()) {
      toast({ title: "Le contenu est requis", variant: "destructive" });
      return;
    }
    if (action === "schedule" && !scheduledISO) {
      toast({ title: "Choisis une date et une heure", variant: "destructive" });
      return;
    }
    setBusy(action);
    try {
      const status = action === "publish" ? "ready" : action === "schedule" ? "scheduled" : "draft";
      const { data: saved, error } = await supabase.from("posts").insert({
        user_id: user.id,
        title: title || content.slice(0, 60),
        content: finalContent,
        image_url: includeImage ? imageUrl : null,
        status,
        scheduled_at: action === "schedule" ? scheduledISO : null,
      }).select().single();
      if (error) throw error;

      if (action === "publish") {
        const { data: pub, error: pubErr } = await supabase.functions.invoke("publish-linkedin", {
          body: { postId: saved.id },
        });
        if (pubErr) throw pubErr;
        if (!pub?.success) throw new Error(pub?.error || "Publish failed");
        toast({ title: "Publié sur LinkedIn 🎉" });
      } else if (action === "schedule") {
        toast({ title: "Programmé", description: `Sera publié le ${format(new Date(scheduledISO!), "PPp")}` });
      } else {
        toast({ title: "Brouillon enregistré" });
      }

      queryClient.invalidateQueries({ queryKey: ["posts"] });
      // reset
      setContent(""); setTitle(""); setImageUrl(null); setTextPrompt(""); setImagePrompt("");
      setHashtags([]); setAwaitingReview(false);
      setScheduleEnabled(false); setScheduleDate(undefined);
    } catch (e: unknown) {
      toast({ title: "Erreur", description: getSafeErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // UI-only orchestrator for the "Génération rapide" card — reuses existing mutations.
  const runQuickGeneration = async () => {
    try {
      const draft = await generateText.mutateAsync("create");
      if (includeImage) {
        await generateImage.mutateAsync({
          visualBrief: isVisualBrief(draft?.visual_brief) ? draft.visual_brief : null,
          prompt: draft?.image_prompt || imagePrompt,
        });
      }
    } catch {
      // Errors are already toasted by each mutation's onError.
    }
  };

  const editorCardClass = "border border-gray-800/80 bg-[#13161a] text-foreground shadow-none";

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight">
          Crée ton{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-violet-500">
            prochain post
          </span>
        </h1>
        <p className="text-muted-foreground mt-2">
          Donne un sujet, l'IA rédige le post et suggère une image — tu relis, ajustes et publies.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* LEFT: editor column */}
        <div className="lg:col-span-8 space-y-6">
          {/* Génération rapide */}
          <Card className={editorCardClass}>
            <CardHeader className="border-b border-gray-800/80 pb-4">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Zap className="h-4 w-4 text-blue-400" />
                Génération rapide
                <Badge className="ml-1 bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/15">
                  texte + image en parallèle
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Sujet du post</Label>
                <Textarea
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  placeholder="Ex : l'impact des tensions géopolitiques sur le cours du cuivre en 2026…"
                  rows={4}
                  className="bg-[#0c0e11] border-gray-800 text-foreground placeholder:text-muted-foreground/60 min-h-[110px]"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                <Button
                  onClick={() => void runQuickGeneration()}
                  disabled={busy === "text" || busy === "image" || !textPrompt.trim()}
                  className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-violet-900/20"
                >
                  {(busy === "text" || busy === "image") ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Génération texte + image
                </Button>
                <div className="flex items-center gap-2">
                  <Switch checked={includeImage} onCheckedChange={setIncludeImage} id="quick-include-image" />
                  <Label htmlFor="quick-include-image" className="text-sm text-muted-foreground cursor-pointer">
                    Inclure une image
                  </Label>
                </div>
                <p className="text-[11px] text-muted-foreground sm:ml-auto sm:max-w-[220px] sm:text-right">
                  L'IA détermine seule l'angle, le ton et le brief visuel à partir du sujet.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* SOURCES block */}
          <Card className={editorCardClass}>
            <CardHeader className="border-b border-gray-800/80">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold flex items-center justify-center">1</span>
                <Lightbulb className="h-4 w-4 text-blue-400" /> Sources & inspirations
                {(selectedSourceIds.length + adhocSources.length) > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-gray-900 border border-gray-700">
                    {selectedSourceIds.length + adhocSources.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <p className="text-xs text-muted-foreground">
                Ajoute des URLs (scrapées via Firecrawl), des mots-clés (recherche web récente) ou des idées en texte libre.
                L'IA s'en sert comme contexte pour rédiger le post.
              </p>

              {savedSources && savedSources.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <BookMarked className="h-3 w-3" /> Sources enregistrées
                  </Label>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {savedSources.map((src: ContentSource) => {
                      const checked = selectedSourceIds.includes(src.id);
                      return (
                        <label
                          key={src.id}
                          className={cn(
                            "flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition",
                            checked
                              ? "border-blue-500/50 bg-blue-500/10"
                              : "border-gray-800 bg-[#0c0e11] hover:bg-[#10141a]"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setSelectedSourceIds((prev) =>
                                c ? [...prev, src.id] : prev.filter((id) => id !== src.id)
                              )
                            }
                          />
                          {src.source_type === "url" ? (
                            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-xs truncate">{src.label || src.value}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ajout ponctuel (uniquement pour ce post)
                </Label>
                <div className="flex gap-2">
                  <Tabs value={newSourceType} onValueChange={(v) => setNewSourceType(v as SourceType)}>
                    <TabsList className="h-9 bg-[#0c0e11] border border-gray-800">
                      <TabsTrigger value="idea" className="text-xs gap-1"><Lightbulb className="h-3 w-3" />Idée</TabsTrigger>
                      <TabsTrigger value="url" className="text-xs gap-1"><Globe className="h-3 w-3" />URL</TabsTrigger>
                      <TabsTrigger value="keyword" className="text-xs gap-1"><Hash className="h-3 w-3" />Mot-clé</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newSourceValue}
                    onChange={(e) => setNewSourceValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdhoc(); } }}
                    placeholder={
                      newSourceType === "url"
                        ? "https://exemple.com/article"
                        : newSourceType === "keyword"
                        ? "ex: AI agents 2026"
                        : "ex: parler du parallèle entre design et code…"
                    }
                    className="bg-[#0c0e11] border-gray-800"
                  />
                  <Button type="button" variant="outline" onClick={addAdhoc} disabled={!newSourceValue.trim()} className="border-gray-700 bg-[#0c0e11] hover:bg-[#151a21]">
                    <Plus className="h-4 w-4" /> Ajouter
                  </Button>
                </div>

                {adhocSources.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {adhocSources.map((s) => (
                      <Badge
                        key={s.id}
                        variant="secondary"
                        className="gap-1.5 pl-2 pr-1 py-1 max-w-full bg-gray-900 border border-gray-700"
                      >
                        {s.type === "url" ? <Globe className="h-3 w-3" /> : s.type === "keyword" ? <Hash className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />}
                        <span className="truncate max-w-[260px]">{s.value}</span>
                        <button
                          type="button"
                          onClick={() => setAdhocSources((p) => p.filter((x) => x.id !== s.id))}
                          className="hover:bg-background/60 rounded p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* TEXT block */}
          <Card className={editorCardClass}>
            <CardHeader className="border-b border-gray-800/80 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold flex items-center justify-center">2</span>
                <Type className="h-4 w-4 text-blue-400" /> Texte du post
              </CardTitle>
              <Tabs value={textMode} onValueChange={(v) => setTextMode(v as Mode)}>
                <TabsList className="h-8 bg-[#0c0e11] border border-gray-800">
                  <TabsTrigger value="ai" className="text-xs gap-1"><Sparkles className="h-3 w-3" />IA</TabsTrigger>
                  <TabsTrigger value="manual" className="text-xs gap-1"><Type className="h-3 w-3" />Manuel</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {textMode === "ai" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Langue & options</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger className="h-7 w-auto gap-1.5 border-none bg-transparent px-2 text-xs text-muted-foreground hover:bg-[#0c0e11]">
                        <Languages className="h-3 w-3" /><SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {POST_LANGUAGES.map((l) => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
                      >
                        <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
                        Options avancées (ton, longueur, cible)
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-gray-800 bg-[#0c0e11] p-3">
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" /> Ton
                          </Label>
                          <Select value={tone} onValueChange={setTone}>
                            <SelectTrigger className="h-9 bg-[#13161a] border-gray-800"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {POST_TONES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Type className="h-3 w-3" /> Longueur
                          </Label>
                          <Select value={length} onValueChange={setLength}>
                            <SelectTrigger className="h-9 bg-[#13161a] border-gray-800"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {POST_LENGTHS.map((l) => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" /> Cible / audience
                          </Label>
                          <Input
                            value={audience}
                            onChange={(e) => setAudience(e.target.value)}
                            placeholder="Laisse vide pour que l'IA la déduise du sujet"
                            className="h-9 bg-[#13161a] border-gray-800"
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => generateText.mutate("create")}
                      disabled={busy === "text"}
                      className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    >
                      {busy === "text" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      Générer le texte
                    </Button>
                    {content && (
                      <Button
                        variant="outline"
                        onClick={() => generateText.mutate("improve")}
                        disabled={busy === "text"}
                        className="border-gray-700 bg-[#0c0e11] hover:bg-[#151a21]"
                      >
                        <RefreshCw className="h-4 w-4" /> Améliorer le brouillon
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {awaitingReview && (
                <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 space-y-3 animate-fade-in-up">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
                    <CheckCircle2 className="h-4 w-4" /> Brouillon généré — à valider
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Rien n'est publié tant que tu n'as pas approuvé. Édite le texte et les hashtags ci-dessous, puis approuve ou régénère.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => submit(scheduleEnabled && scheduledISO ? "schedule" : "publish")}
                      disabled={!!busy || !finalContent.trim() || (scheduleEnabled && !scheduledISO)}
                      className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                      size="sm"
                    >
                      {busy === "publish" || busy === "schedule"
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <CheckCircle2 className="h-4 w-4" />}
                      {scheduleEnabled && scheduledISO ? "Approuver & Programmer" : "Approuver & Publier"}
                    </Button>
                    <Button
                      onClick={() => generateText.mutate("create")}
                      disabled={busy === "text"}
                      variant="outline"
                      size="sm"
                      className="border-gray-700 bg-[#0c0e11]"
                    >
                      {busy === "text" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Régénérer
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Contenu {hashtags.length > 0 && "(hors hashtags)"}</Label>
                  <span className={cn("text-xs", charCount > 3000 ? "text-destructive" : "text-muted-foreground")}>
                    {charCount} / 3000
                  </span>
                </div>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Écris ton post ici, ou laisse l'IA générer…"
                  rows={12}
                  className="bg-[#0c0e11] border-gray-800 font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" /> Hashtags
                </Label>
                {hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {hashtags.map((h) => (
                      <Badge key={h} variant="secondary" className="gap-1 pl-2 pr-1 py-1 bg-gray-900 border border-gray-700">
                        #{h}
                        <button
                          type="button"
                          onClick={() => setHashtags((p) => p.filter((x) => x !== h))}
                          className="hover:bg-background/60 rounded p-0.5"
                          aria-label={`Retirer #${h}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={newHashtag}
                    onChange={(e) => setNewHashtag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHashtag(); } }}
                    placeholder="ajouter un hashtag (sans #)"
                    className="h-9 bg-[#0c0e11] border-gray-800"
                  />
                  <Button type="button" variant="outline" onClick={addHashtag} disabled={!newHashtag.trim()} className="border-gray-700 bg-[#0c0e11]">
                    <Plus className="h-4 w-4" /> Ajouter
                  </Button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-gray-800/80">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Titre interne (optionnel)</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Pour t'y retrouver dans l'historique"
                  className="bg-[#0c0e11] border-gray-800"
                />
              </div>
            </CardContent>
          </Card>

          {/* IMAGE block */}
          <Card className={editorCardClass}>
            <CardHeader className="border-b border-gray-800/80 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold flex items-center justify-center">3</span>
                <ImageIcon className="h-4 w-4 text-blue-400" /> Image
                <Switch checked={includeImage} onCheckedChange={setIncludeImage} className="ml-2" />
              </CardTitle>
              <Tabs value={imageMode} onValueChange={(v) => setImageMode(v as Mode)}>
                <TabsList className="h-8 bg-[#0c0e11] border border-gray-800">
                  <TabsTrigger value="ai" className="text-xs gap-1"><Sparkles className="h-3 w-3" />IA</TabsTrigger>
                  <TabsTrigger value="manual" className="text-xs gap-1"><Upload className="h-3 w-3" />Upload</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            {includeImage && (
              <CardContent className="p-5 space-y-4">
                {imageMode === "ai" ? (
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Brief visuel (généré automatiquement)</Label>
                    <Textarea
                      value={imagePrompt}
                      onChange={(e) => {
                        setImagePrompt(e.target.value);
                        setVisualBrief(null);
                      }}
                      placeholder="Généré automatiquement à partir de ton post — modifiable si besoin."
                      rows={3}
                      className="bg-[#0c0e11] border-gray-800"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Le brief (données, titre, labels) est déduit du post — dashboard minimaliste, sans carte ni frontières. Style & palette marque →{" "}
                      <button onClick={() => navigate("/image-studio")} className="text-blue-400 hover:underline">Image Studio</button>.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        onClick={() => generateImage.mutate()}
                        disabled={busy === "image"}
                        className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                      >
                        {busy === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {imageUrl ? "Régénérer" : "Générer l'image"}
                      </Button>
                      {imageUrl && (
                        <Button
                          variant="outline"
                          onClick={() => setImageUrl(null)}
                          className="border-gray-700 bg-black/60 text-muted-foreground hover:bg-gray-900 hover:text-foreground"
                        >
                          <X className="h-4 w-4" /> Retirer
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy === "upload"}
                      className="w-full border-dashed border-gray-700 h-32 bg-[#0c0e11] hover:bg-[#10141a]"
                    >
                      {busy === "upload" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <div className="flex flex-col items-center gap-2">
                          <Upload className="h-5 w-5" />
                          <span className="text-sm">{imageUrl ? "Remplacer l'image" : "Téléverser une image"}</span>
                        </div>
                      )}
                    </Button>
                  </div>
                )}

                {imageUrl && (
                  <div className="rounded-xl overflow-hidden ring-1 ring-gray-800 bg-[#0c0e11]">
                    <img src={imageUrl} alt="preview" className="w-full max-h-80 object-contain" />
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* RIGHT: preview + publication */}
        <div className="lg:col-span-4 space-y-6 sticky top-6 self-start">
          <Card className="border border-gray-800/80 overflow-hidden shadow-none bg-transparent">
            <CardHeader className="border-b border-gray-800/80 bg-[#13161a]">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Linkedin className="h-4 w-4 text-[#0A66C2]" /> Aperçu LinkedIn
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 bg-white text-neutral-900">
              <div className="p-4 flex items-center gap-3 border-b border-neutral-200">
                <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-blue-600 to-violet-600 flex items-center justify-center text-white font-semibold">
                  {user?.email?.[0]?.toUpperCase() || "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{user?.email?.split("@")[0] || "toi"}</p>
                  <p className="text-xs text-neutral-500 flex items-center gap-1">
                    À l'instant · <Globe className="h-3 w-3" />
                  </p>
                </div>
              </div>
              <div className="px-4 py-3 text-sm whitespace-pre-wrap min-h-[80px]">
                {finalContent || <span className="text-neutral-400">Ton post apparaîtra ici…</span>}
              </div>
              {includeImage && imageUrl && (
                <div className="border-t border-neutral-200">
                  <img src={imageUrl} alt="" className="w-full max-h-80 object-cover" />
                </div>
              )}
              <div className="px-4 py-3 border-t border-neutral-200 flex gap-6 text-xs text-neutral-500">
                <span className="inline-flex items-center gap-1.5"><ThumbsUp className="h-3.5 w-3.5" /> J'aime</span>
                <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Commenter</span>
                <span className="inline-flex items-center gap-1.5"><Share2 className="h-3.5 w-3.5" /> Partager</span>
              </div>
            </CardContent>
          </Card>

          <Card className={editorCardClass}>
            <CardHeader className="border-b border-gray-800/80">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Send className="h-4 w-4 text-blue-400" /> Publication
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4 text-blue-400" /> Programmer
                </Label>
                <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
              </div>
              {scheduleEnabled && (
                <div className="space-y-2 animate-fade-in-up">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start border-gray-700 bg-[#0c0e11]", !scheduleDate && "text-muted-foreground")}>
                        <CalendarIcon className="h-4 w-4" />
                        {scheduleDate ? format(scheduleDate, "PPP") : "Choisir une date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={scheduleDate}
                        onSelect={setScheduleDate}
                        disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="bg-[#0c0e11] border-gray-800" />
                </div>
              )}

              <div className="flex flex-col gap-2 pt-3 border-t border-gray-800/80">
                {scheduleEnabled ? (
                  <Button
                    onClick={() => submit("schedule")}
                    disabled={!!busy || !finalContent.trim() || !scheduledISO}
                    className="w-full bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    size="lg"
                  >
                    {busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarIcon className="h-4 w-4" />}
                    Programmer
                  </Button>
                ) : (
                  <Button
                    onClick={() => submit("publish")}
                    disabled={!!busy || !finalContent.trim()}
                    className="w-full bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    size="lg"
                  >
                    {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Publier maintenant
                  </Button>
                )}
                <Button
                  onClick={() => submit("draft")}
                  disabled={!!busy || !finalContent.trim()}
                  className="w-full bg-black border border-gray-700 text-foreground hover:bg-gray-900"
                >
                  {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Enregistrer en brouillon
                </Button>
                <Button
                  onClick={() => { setAutoName(title || textPrompt.slice(0, 40) || "Mon automatisation"); setAutoOpen(true); }}
                  disabled={!canAutomate}
                  className="w-full bg-black border border-gray-700 text-foreground hover:bg-gray-900"
                  title={canAutomate ? "" : "Active le mode IA pour le texte (et l'image si activée) et renseigne un sujet"}
                >
                  <Repeat className="h-4 w-4" />
                  Automatiser (récurrent)
                </Button>
                {!canAutomate && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Pour automatiser : texte en mode IA + sujet. Image (si activée) en mode IA aussi.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Automation dialog */}
      <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Repeat className="h-5 w-5 text-primary" /> Automatiser cette recette</DialogTitle>
            <DialogDescription>
              Le système re-générera et publiera un nouveau post à chaque exécution, en utilisant le prompt et les sources actuels.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nom</Label>
              <Input value={autoName} onChange={(e) => setAutoName(e.target.value)} placeholder="Ex: Veille IA hebdo" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Jours</Label>
              <div className="flex gap-2 flex-wrap">
                {DAYS.map((d) => {
                  const active = autoDays.includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() => setAutoDays((cur) => active ? cur.filter((x) => x !== d.v) : [...cur, d.v].sort())}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm border transition",
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                      )}
                    >{d.label}</button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Heure</Label>
                <Input type="number" min={0} max={23} value={autoHour}
                  onChange={(e) => setAutoHour(Math.min(23, Math.max(0, +e.target.value || 0)))} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Minute</Label>
                <Input type="number" min={0} max={59} value={autoMinute}
                  onChange={(e) => setAutoMinute(Math.min(59, Math.max(0, +e.target.value || 0)))} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Timezone</Label>
                <Select value={autoTz} onValueChange={setAutoTz}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Europe/Paris","Europe/London","Europe/Berlin","Europe/Madrid","America/New_York","America/Los_Angeles","Asia/Tokyo","Asia/Dubai","UTC"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-border/50 bg-background/40 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-3 w-3" /> Récapitulatif</div>
              <p>• Texte : IA — prompt actuel</p>
              <p>• Image : {includeImage && imageMode === "ai" ? "générée par IA à chaque run" : "aucune"}</p>
              <p>• Sources : {selectedSourceIds.length + adhocSources.length} liée(s)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAutoOpen(false)}>Annuler</Button>
            <Button
              onClick={() => createSchedule.mutate()}
              disabled={createSchedule.isPending || !autoName.trim() || !autoDays.length}
              className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
            >
              {createSchedule.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
              Créer l'automatisation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Composer;
