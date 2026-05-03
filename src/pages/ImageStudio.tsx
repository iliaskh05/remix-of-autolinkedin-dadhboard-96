import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, Download, Wand2, Palette, Type, Layout, Image as ImageIcon,
  X, Plus, Star, Send, Upload, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MODELS = [
  { value: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2 — rapide & qualité pro" },
  { value: "google/gemini-2.5-flash-image", label: "Nano Banana — rapide & économique" },
  { value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image — qualité max (lent)" },
];

const STYLES = [
  { v: "modern editorial, clean composition, premium feel", label: "Éditorial" },
  { v: "minimalist flat design, generous whitespace, geometric", label: "Minimaliste" },
  { v: "3D render, soft lighting, glossy materials, depth", label: "3D" },
  { v: "professional photography, natural lighting, shallow depth of field", label: "Photo" },
  { v: "vibrant gradient illustration, abstract shapes, dynamic", label: "Gradient abstrait" },
  { v: "isometric illustration, technical, detailed line art", label: "Isométrique" },
  { v: "bold magazine cover, high contrast, strong typography", label: "Magazine" },
  { v: "hand-drawn sketch, organic lines, paper texture", label: "Sketch" },
];

const MOODS = [
  { v: "professional and confident", label: "Pro & confiant" },
  { v: "energetic and bold", label: "Énergique" },
  { v: "calm and minimalist", label: "Calme" },
  { v: "playful and friendly", label: "Friendly" },
  { v: "luxurious and premium", label: "Luxe" },
  { v: "innovative and futuristic", label: "Futuriste" },
];

const RATIOS = [
  { v: "1:1 square, perfect for LinkedIn feed", label: "1:1 Carré", css: "aspect-square" },
  { v: "16:9 landscape, banner format", label: "16:9 Bannière", css: "aspect-video" },
  { v: "4:5 portrait, mobile-optimized", label: "4:5 Portrait", css: "aspect-[4/5]" },
];

const POSITIONS = [
  ["top-left", "top-center", "top-right"],
  ["center-left", "center", "center-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const PRESET_PALETTES = [
  { name: "LinkedIn", colors: ["#0A66C2", "#FFFFFF", "#1D2226"] },
  { name: "Sunset", colors: ["#FF6B6B", "#FFD93D", "#1A1A2E"] },
  { name: "Forest", colors: ["#2D5016", "#A4C639", "#F4F4F4"] },
  { name: "Ocean", colors: ["#0077B6", "#90E0EF", "#03045E"] },
  { name: "Mono", colors: ["#000000", "#FFFFFF", "#888888"] },
];

const FAV_KEY = "image-studio-favorites";

const ImageStudio = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  // Subject
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [aspectRatio, setAspectRatio] = useState(RATIOS[0].v);

  // Style
  const [style, setStyle] = useState(STYLES[0].v);
  const [mood, setMood] = useState(MOODS[0].v);

  // Colors
  const [colors, setColors] = useState<string[]>(["#0A66C2", "#FFFFFF"]);
  const [newColor, setNewColor] = useState("#3B82F6");
  const [favorites, setFavorites] = useState<{ name: string; colors: string[] }[]>([]);

  // Text overlay
  const [textEnabled, setTextEnabled] = useState(false);
  const [overlayText, setOverlayText] = useState("");
  const [overlayPosition, setOverlayPosition] = useState("center");
  const [overlayWeight, setOverlayWeight] = useState("bold");
  const [overlayColor, setOverlayColor] = useState("#FFFFFF");

  // Wordmark
  const [wordmarkEnabled, setWordmarkEnabled] = useState(false);
  const [wordmarkText, setWordmarkText] = useState("");
  const [wordmarkPosition, setWordmarkPosition] = useState("bottom-center");

  // Layout
  const [margin, setMargin] = useState(0);

  // Edit mode
  const [inputImage, setInputImage] = useState<string | null>(null);

  // Output
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  const saveFavorites = (favs: typeof favorites) => {
    setFavorites(favs);
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  };

  const addColor = () => {
    if (colors.length >= 5) { toast({ title: "Max 5 couleurs", variant: "destructive" }); return; }
    setColors((c) => [...c, newColor]);
  };

  const saveCurrentPalette = () => {
    const name = prompt && prompt.length > 0 ? prompt.slice(0, 20) : `Palette ${favorites.length + 1}`;
    saveFavorites([{ name, colors: [...colors] }, ...favorites].slice(0, 10));
    toast({ title: "Palette sauvegardée ⭐" });
  };

  const uploadInput = async (file: File) => {
    const { data: session } = await supabase.auth.getUser();
    const userId = session.user?.id;
    if (!userId) return;
    const path = `${userId}/${crypto.randomUUID()}.${file.name.split(".").pop() || "png"}`;
    const { error } = await supabase.storage.from("post-assets").upload(path, file, { contentType: file.type });
    if (error) { toast({ title: "Upload échoué", variant: "destructive" }); return; }
    const { data } = supabase.storage.from("post-assets").getPublicUrl(path);
    setInputImage(data.publicUrl);
    toast({ title: "Image source chargée" });
  };

  const generate = async () => {
    if (!prompt.trim() && !inputImage) {
      toast({ title: "Prompt ou image source requis", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: {
          prompt: prompt || "Refine this image.",
          model,
          aspectRatio,
          style,
          mood,
          colors,
          bottomMarginPercent: margin,
          inputImageUrl: inputImage,
          textOverlay: textEnabled && overlayText.trim() ? {
            text: overlayText.trim(),
            position: overlayPosition,
            weight: overlayWeight,
            color: overlayColor,
          } : undefined,
          wordmark: wordmarkEnabled && wordmarkText.trim() ? {
            text: wordmarkText.trim(),
            position: wordmarkPosition,
          } : undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Échec");
      setImageUrl(data.imageUrl);
      setHistory((h) => [data.imageUrl, ...h].slice(0, 8));
      toast({ title: "Image générée ✨" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const sendToComposer = () => {
    if (!imageUrl) return;
    sessionStorage.setItem("composer-image", imageUrl);
    navigate("/composer");
  };

  const currentRatioCss = RATIOS.find((r) => r.v === aspectRatio)?.css || "aspect-square";

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in-up">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Image Studio</div>
        <h1 className="text-4xl font-semibold tracking-tight">
          Crée ton <span className="text-gradient">visuel parfait</span>
        </h1>
        <p className="text-muted-foreground mt-2">Style, palette, texte intégré, position — contrôle total sur ton image.</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_460px] gap-6">
        {/* LEFT: controls */}
        <div className="space-y-6">
          {/* SUBJECT */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /> Sujet</CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Décris l'image</Label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ex: une équipe diversifiée en réunion stratégique, vue plongeante, table en bois clair…"
                  rows={3}
                  className="bg-background/40 mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Modèle</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Format</Label>
                  <Select value={aspectRatio} onValueChange={setAspectRatio}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{RATIOS.map((r) => <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {/* Edit existing */}
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">Image source (optionnel — mode édition)</Label>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadInput(e.target.files[0])} />
                {inputImage ? (
                  <div className="relative inline-block">
                    <img src={inputImage} alt="source" className="h-24 rounded-md border border-border/50" />
                    <button onClick={() => setInputImage(null)} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-full border-dashed">
                    <Upload className="h-4 w-4" /> Téléverser une image à éditer
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* STYLE */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Style & ambiance</CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Style visuel</Label>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.v}
                      onClick={() => setStyle(s.v)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm border transition",
                        style === s.v ? "bg-primary text-primary-foreground border-primary" : "bg-background/40 hover:bg-accent border-border/40"
                      )}
                    >{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Mood</Label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map((m) => (
                    <button
                      key={m.v}
                      onClick={() => setMood(m.v)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm border transition",
                        mood === m.v ? "bg-primary text-primary-foreground border-primary" : "bg-background/40 hover:bg-accent border-border/40"
                      )}
                    >{m.label}</button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* COLORS */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="border-b border-border/40 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Palette</CardTitle>
              <Button size="sm" variant="ghost" onClick={saveCurrentPalette} title="Sauvegarder la palette actuelle">
                <Star className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Couleurs actuelles ({colors.length}/5)</Label>
                <div className="flex flex-wrap gap-2">
                  {colors.map((c, i) => (
                    <div key={i} className="relative group">
                      <input
                        type="color"
                        value={c}
                        onChange={(e) => setColors((cur) => cur.map((x, j) => j === i ? e.target.value : x))}
                        className="h-12 w-12 rounded-md border border-border/50 cursor-pointer"
                      />
                      <button
                        onClick={() => setColors((cur) => cur.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                      ><X className="h-3 w-3" /></button>
                      <span className="block text-[10px] font-mono text-center text-muted-foreground mt-1">{c}</span>
                    </div>
                  ))}
                  <div className="flex flex-col items-center gap-1">
                    <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-12 w-12 rounded-md border border-dashed border-border cursor-pointer" />
                    <Button size="sm" variant="ghost" onClick={addColor} className="h-6 text-xs"><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Palettes prédéfinies</Label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {PRESET_PALETTES.map((p) => (
                    <button key={p.name} onClick={() => setColors(p.colors)} className="border border-border/40 rounded-md p-2 hover:bg-accent transition text-left">
                      <div className="flex gap-1 mb-1">
                        {p.colors.map((c, i) => <div key={i} className="h-4 w-4 rounded" style={{ background: c }} />)}
                      </div>
                      <span className="text-xs">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {favorites.length > 0 && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Mes favoris</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {favorites.map((f, i) => (
                      <div key={i} className="relative group">
                        <button onClick={() => setColors(f.colors)} className="w-full border border-border/40 rounded-md p-2 hover:bg-accent transition text-left">
                          <div className="flex gap-1 mb-1">
                            {f.colors.map((c, j) => <div key={j} className="h-4 w-4 rounded" style={{ background: c }} />)}
                          </div>
                          <span className="text-xs truncate block">{f.name}</span>
                        </button>
                        <button
                          onClick={() => saveFavorites(favorites.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                        ><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* TEXT OVERLAY */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="border-b border-border/40 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2"><Type className="h-4 w-4 text-primary" /> Texte intégré</CardTitle>
              <Switch checked={textEnabled} onCheckedChange={setTextEnabled} />
            </CardHeader>
            {textEnabled && (
              <CardContent className="p-5 space-y-4">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Texte à afficher</Label>
                  <Textarea value={overlayText} onChange={(e) => setOverlayText(e.target.value)} placeholder={`Ex: "L'IA change tout."`} rows={2} className="bg-background/40 mt-1" />
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Position dans l'image</Label>
                  <div className="inline-grid grid-cols-3 gap-1 p-2 rounded-md border border-border/40 bg-background/40">
                    {POSITIONS.flat().map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setOverlayPosition(pos)}
                        className={cn(
                          "h-9 w-12 rounded transition",
                          overlayPosition === pos ? "bg-primary" : "bg-muted hover:bg-accent"
                        )}
                        title={pos}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Position : <span className="font-mono">{overlayPosition}</span></p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Style</Label>
                    <Select value={overlayWeight} onValueChange={setOverlayWeight}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bold">Gras</SelectItem>
                        <SelectItem value="extra-bold display">Display extra-gras</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="light italic serif">Serif italique léger</SelectItem>
                        <SelectItem value="handwritten script">Manuscrit</SelectItem>
                        <SelectItem value="condensed uppercase">Condensé MAJUSCULES</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Couleur</Label>
                    <input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-border/50 cursor-pointer" />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* WORDMARK + LAYOUT */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base flex items-center gap-2"><Layout className="h-4 w-4 text-primary" /> Marque & marges</CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Wordmark / nom de marque</Label>
                <Switch checked={wordmarkEnabled} onCheckedChange={setWordmarkEnabled} />
              </div>
              {wordmarkEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <Input value={wordmarkText} onChange={(e) => setWordmarkText(e.target.value)} placeholder="ex: TonNom" className="bg-background/40" />
                  <Select value={wordmarkPosition} onValueChange={setWordmarkPosition}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POSITIONS.flat().map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Marge basse vide</Label>
                  <span className="text-sm font-mono text-muted-foreground">{margin}%</span>
                </div>
                <Slider value={[margin]} onValueChange={(v) => setMargin(v[0])} min={0} max={25} step={1} />
                <p className="text-[11px] text-muted-foreground">Réserve un espace en bas (utile si tu superposes du texte plus tard).</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: preview */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl overflow-hidden">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <ImageIcon className="h-4 w-4" /> Aperçu
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className={cn("w-full rounded-lg overflow-hidden bg-muted flex items-center justify-center", currentRatioCss)}>
                {loading ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-xs">Génération en cours…</span>
                  </div>
                ) : imageUrl ? (
                  <img src={imageUrl} alt="generated" className="w-full h-full object-cover" />
                ) : (
                  <p className="text-sm text-muted-foreground">L'aperçu apparaîtra ici</p>
                )}
              </div>

              <div className="mt-4 grid gap-2">
                <Button onClick={generate} disabled={loading} size="lg" className="bg-gradient-to-r from-primary to-accent text-white glow-primary">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : imageUrl ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {imageUrl ? "Régénérer" : "Générer l'image"}
                </Button>
                {imageUrl && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={sendToComposer}>
                      <Send className="h-4 w-4" /> Envoyer au Composer
                    </Button>
                    <Button asChild variant="outline">
                      <a href={imageUrl} download target="_blank" rel="noreferrer">
                        <Download className="h-4 w-4" /> Télécharger
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active config recap */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardContent className="p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Configuration active</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{RATIOS.find((r) => r.v === aspectRatio)?.label}</Badge>
                <Badge variant="outline">{STYLES.find((s) => s.v === style)?.label}</Badge>
                <Badge variant="outline">{MOODS.find((m) => m.v === mood)?.label}</Badge>
                {textEnabled && overlayText && <Badge variant="outline">Texte: {overlayPosition}</Badge>}
                {wordmarkEnabled && wordmarkText && <Badge variant="outline">© {wordmarkText}</Badge>}
                {colors.map((c, i) => <span key={i} className="h-5 w-5 rounded border border-border/50" style={{ background: c }} />)}
              </div>
            </CardContent>
          </Card>

          {/* History */}
          {history.length > 1 && (
            <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Historique récent</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-4 gap-2">
                  {history.map((url, i) => (
                    <button key={i} onClick={() => setImageUrl(url)} className={cn(
                      "aspect-square rounded-md overflow-hidden border-2 transition",
                      imageUrl === url ? "border-primary" : "border-transparent hover:border-border"
                    )}>
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageStudio;
