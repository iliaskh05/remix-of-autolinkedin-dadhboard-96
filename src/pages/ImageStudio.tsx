import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Download } from "lucide-react";

const MODELS = [
  { value: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2 — rapide & qualité pro (par défaut)" },
  { value: "google/gemini-2.5-flash-image", label: "Nano Banana — rapide & économique" },
  { value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image — qualité max (plus lent)" },
];

const ImageStudio = () => {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [margin, setMargin] = useState(14);
  const [model, setModel] = useState(MODELS[0].value);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim()) {
      toast({ title: "Prompt requis", variant: "destructive" });
      return;
    }
    setLoading(true);
    setImageUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: { prompt, bottomMarginPercent: margin, model },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Échec de la génération");
      setImageUrl(data.imageUrl);
      toast({ title: "Image générée" });
    } catch (e) {
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Échec",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Image Studio</h1>
        <p className="text-muted-foreground mt-1">
          Générateur 1:1 avec wordmark CommoHedge centré en bas.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Paramètres</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="prompt">Sujet de l'image</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: hausse du prix du cacao, illustration éditoriale minimaliste"
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Marge basse (zone wordmark)</Label>
                <span className="text-sm font-mono text-muted-foreground">{margin}%</span>
              </div>
              <Slider
                value={[margin]}
                onValueChange={(v) => setMargin(v[0])}
                min={8}
                max={25}
                step={1}
              />
              <p className="text-xs text-muted-foreground">
                Réserve une bande vide en bas pour garantir lisibilité du wordmark « CommoHedge ».
              </p>
            </div>

            <Button onClick={generate} disabled={loading} className="w-full" size="lg">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Générer l'image
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Aperçu</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="aspect-square w-full bg-muted rounded-lg overflow-hidden flex items-center justify-center">
              {loading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : imageUrl ? (
                <img src={imageUrl} alt="Generated" className="w-full h-full object-cover" />
              ) : (
                <p className="text-sm text-muted-foreground">Aucune image</p>
              )}
            </div>
            {imageUrl && (
              <Button asChild variant="outline" className="w-full mt-4">
                <a href={imageUrl} download target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" /> Télécharger
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ImageStudio;
