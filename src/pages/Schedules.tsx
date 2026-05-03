import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Play, Trash2, Pencil, Clock, Power, Loader2, CalendarClock, History, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const DAYS = [
  { v: 1, label: "Lun" }, { v: 2, label: "Mar" }, { v: 3, label: "Mer" },
  { v: 4, label: "Jeu" }, { v: 5, label: "Ven" }, { v: 6, label: "Sam" }, { v: 7, label: "Dim" },
];

const TIMEZONES = [
  "Europe/Paris", "Europe/London", "Europe/Berlin", "Europe/Madrid",
  "America/New_York", "America/Los_Angeles", "America/Chicago",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Dubai", "UTC",
];

type Schedule = {
  id: string;
  name: string;
  prompt: string;
  tone_instructions: string | null;
  saved_source_ids: string[];
  adhoc_sources: { type: "url" | "keyword" | "idea"; value: string }[];
  days_of_week: number[];
  hour: number;
  minute: number;
  timezone: string;
  image_mode: "none" | "ai";
  image_prompt: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
};

const emptyForm = (): Partial<Schedule> => ({
  name: "",
  prompt: "",
  tone_instructions: "",
  saved_source_ids: [],
  adhoc_sources: [],
  days_of_week: [1, 3, 5],
  hour: 9,
  minute: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
  image_mode: "none",
  image_prompt: "",
  enabled: true,
});

function computeNextRunPreview(days: number[], hour: number, minute: number, tz: string): string {
  if (!days.length) return "—";
  // simple client preview using browser's local rendering of the candidate
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const c = new Date(now.getTime() + i * 86400000);
    const wd = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(c));
    const wdName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(c);
    const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    if (!days.includes(wdMap[wdName])) continue;
    const dateStr = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "2-digit", month: "short" }).format(c);
    return `${dateStr} à ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${tz})`;
  }
  return "—";
}

export default function Schedules() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [adhocType, setAdhocType] = useState<"url" | "keyword" | "idea">("url");
  const [adhocValue, setAdhocValue] = useState("");

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("schedules").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown) as Schedule[];
    },
  });

  const { data: savedSources } = useQuery({
    queryKey: ["content_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("content_sources").select("*").eq("enabled", true);
      return data || [];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["schedule_runs"],
    queryFn: async () => {
      const { data } = await supabase.from("schedule_runs").select("*").order("created_at", { ascending: false }).limit(20);
      return data || [];
    },
    refetchInterval: 15000,
  });

  const upsert = useMutation({
    mutationFn: async (s: Partial<Schedule>) => {
      const next = computeNextRunISO(s.days_of_week!, s.hour!, s.minute!, s.timezone!);
      const payload: any = {
        user_id: user!.id,
        name: s.name,
        prompt: s.prompt,
        tone_instructions: s.tone_instructions || null,
        saved_source_ids: s.saved_source_ids || [],
        adhoc_sources: s.adhoc_sources || [],
        days_of_week: s.days_of_week,
        hour: s.hour,
        minute: s.minute,
        timezone: s.timezone,
        image_mode: s.image_mode,
        image_prompt: s.image_prompt || null,
        enabled: s.enabled,
        next_run_at: next,
      };
      if (s.id) {
        const { error } = await supabase.from("schedules").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("schedules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); setOpen(false); setEditing(null); toast.success("Schedule enregistré"); },
    onError: (e: any) => toast.error(e?.message || "Erreur"),
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("schedules").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); toast.success("Supprimé"); },
  });

  const runNow = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("run-schedules", { body: { schedule_id: id } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Échec");
      const r = data.results?.[0];
      if (r && !r.ok) throw new Error(r.error || "Échec");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedules"] }); qc.invalidateQueries({ queryKey: ["schedule_runs"] }); toast.success("Publié !"); },
    onError: (e: any) => toast.error(e?.message || "Échec"),
  });

  const openNew = () => { setEditing(emptyForm()); setOpen(true); };
  const openEdit = (s: Schedule) => { setEditing({ ...s }); setOpen(true); };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedules</h1>
          <p className="text-muted-foreground mt-1">Automatise tes publications LinkedIn récurrentes</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Nouveau schedule</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !schedules?.length ? (
        <Card className="p-12 text-center">
          <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">Aucun schedule configuré</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Crée ton premier plan automatique pour publier régulièrement.</p>
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Créer un schedule</Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {schedules.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold text-lg">{s.name}</h3>
                    <Badge variant={s.enabled ? "default" : "secondary"}>{s.enabled ? "Actif" : "Pause"}</Badge>
                    <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />
                      {s.days_of_week.map((d) => DAYS.find((x) => x.v === d)?.label).join(" ")} • {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}
                    </Badge>
                    {s.image_mode === "ai" && <Badge variant="outline">+ image IA</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{s.prompt}</p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    {s.next_run_at && <span>Prochain : {format(new Date(s.next_run_at), "dd MMM HH:mm")}</span>}
                    {s.last_run_at && <span>Dernier : {format(new Date(s.last_run_at), "dd MMM HH:mm")}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={s.enabled} onCheckedChange={(v) => toggleEnabled.mutate({ id: s.id, enabled: v })} />
                  <Button size="icon" variant="ghost" disabled={runNow.isPending} onClick={() => runNow.mutate(s.id)} title="Run now">
                    {runNow.isPending && runNow.variables === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Supprimer ?")) remove.mutate(s.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!!runs?.length && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Historique des exécutions</h2>
          </div>
          <div className="space-y-2">
            {runs.map((r: any) => {
              const sched = schedules?.find((s) => s.id === r.schedule_id);
              return (
                <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge variant={r.status === "success" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                    <span className="font-medium">{sched?.name || "—"}</span>
                    {r.message && <span className="text-muted-foreground text-xs">{r.message}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{format(new Date(r.created_at), "dd MMM HH:mm")}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Modifier le schedule" : "Nouveau schedule"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-5">
              <div>
                <Label>Nom</Label>
                <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Veille IA hebdo" />
              </div>

              <div>
                <Label>Prompt / instructions</Label>
                <Textarea
                  value={editing.prompt || ""}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                  placeholder="Ex: Résume l'actu IA de la semaine en post LinkedIn engageant pour CTOs."
                  rows={3}
                />
              </div>

              <div>
                <Label>Ton (optionnel — sinon utilise celui des Settings)</Label>
                <Textarea value={editing.tone_instructions || ""} onChange={(e) => setEditing({ ...editing, tone_instructions: e.target.value })} rows={2} />
              </div>

              <div>
                <Label className="mb-2 block">Jours</Label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS.map((d) => {
                    const active = (editing.days_of_week || []).includes(d.v);
                    return (
                      <button
                        key={d.v}
                        type="button"
                        onClick={() => {
                          const cur = new Set(editing.days_of_week || []);
                          if (active) cur.delete(d.v); else cur.add(d.v);
                          setEditing({ ...editing, days_of_week: Array.from(cur).sort() });
                        }}
                        className={`px-3 py-1.5 rounded-md text-sm border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                      >{d.label}</button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Heure</Label>
                  <Input type="number" min={0} max={23} value={editing.hour ?? 9}
                    onChange={(e) => setEditing({ ...editing, hour: Math.min(23, Math.max(0, +e.target.value || 0)) })} />
                </div>
                <div>
                  <Label>Minute</Label>
                  <Input type="number" min={0} max={59} value={editing.minute ?? 0}
                    onChange={(e) => setEditing({ ...editing, minute: Math.min(59, Math.max(0, +e.target.value || 0)) })} />
                </div>
                <div>
                  <Label>Timezone</Label>
                  <Select value={editing.timezone} onValueChange={(v) => setEditing({ ...editing, timezone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Prochaine exécution prévue : {computeNextRunPreview(editing.days_of_week || [], editing.hour ?? 9, editing.minute ?? 0, editing.timezone || "Europe/Paris")}</p>

              {!!savedSources?.length && (
                <div>
                  <Label className="mb-2 block">Sources sauvegardées</Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                    {savedSources.map((src: any) => {
                      const checked = (editing.saved_source_ids || []).includes(src.id);
                      return (
                        <label key={src.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                          <input type="checkbox" checked={checked} onChange={() => {
                            const cur = new Set(editing.saved_source_ids || []);
                            if (checked) cur.delete(src.id); else cur.add(src.id);
                            setEditing({ ...editing, saved_source_ids: Array.from(cur) });
                          }} />
                          <Badge variant="outline" className="text-[10px]">{src.source_type}</Badge>
                          <span className="truncate">{src.label || src.value}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <Label className="mb-2 block">Sources ad-hoc</Label>
                <div className="flex gap-2">
                  <Select value={adhocType} onValueChange={(v: any) => setAdhocType(v)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="url">URL</SelectItem>
                      <SelectItem value="keyword">Mot-clé</SelectItem>
                      <SelectItem value="idea">Idée</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input value={adhocValue} onChange={(e) => setAdhocValue(e.target.value)} placeholder="Saisir puis Entrée"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && adhocValue.trim()) {
                        e.preventDefault();
                        setEditing({ ...editing, adhoc_sources: [...(editing.adhoc_sources || []), { type: adhocType, value: adhocValue.trim() }] });
                        setAdhocValue("");
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => {
                    if (!adhocValue.trim()) return;
                    setEditing({ ...editing, adhoc_sources: [...(editing.adhoc_sources || []), { type: adhocType, value: adhocValue.trim() }] });
                    setAdhocValue("");
                  }}>Ajouter</Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(editing.adhoc_sources || []).map((s, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      <span className="text-[10px] uppercase">{s.type}</span> {s.value}
                      <button onClick={() => setEditing({ ...editing, adhoc_sources: (editing.adhoc_sources || []).filter((_, j) => j !== i) })}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Image</Label>
                <Select value={editing.image_mode} onValueChange={(v: any) => setEditing({ ...editing, image_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune image</SelectItem>
                    <SelectItem value="ai">Générer par IA à chaque run</SelectItem>
                  </SelectContent>
                </Select>
                {editing.image_mode === "ai" && (
                  <Textarea
                    className="mt-2"
                    placeholder="Prompt image (laisser vide pour utiliser le titre du post)"
                    value={editing.image_prompt || ""}
                    onChange={(e) => setEditing({ ...editing, image_prompt: e.target.value })}
                    rows={2}
                  />
                )}
              </div>

              <div className="flex items-center justify-between border rounded-md p-3">
                <div className="flex items-center gap-2"><Power className="h-4 w-4" /> <Label>Activer ce schedule</Label></div>
                <Switch checked={editing.enabled ?? true} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={() => editing && upsert.mutate(editing)} disabled={upsert.isPending || !editing?.name?.trim() || !editing?.prompt?.trim() || !editing?.days_of_week?.length}>
              {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mirror server-side computeNextRun
function computeNextRunISO(days: number[], hour: number, minute: number, tz: string): string {
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const c = new Date(now.getTime() + i * 86400000);
    const wdName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(c);
    const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    if (!days.includes(wdMap[wdName])) continue;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(c);
    const [y, m, d] = parts.split("-").map(Number);
    const local = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    const asUTC = new Date(local + "Z").getTime();
    const tzString = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(asUTC));
    const mm = tzString.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    let offsetMin = 0;
    if (mm) {
      const tzAsUTC = Date.UTC(+mm[3], +mm[1] - 1, +mm[2], +mm[4], +mm[5]);
      offsetMin = (asUTC - tzAsUTC) / 60000;
    }
    const target = new Date(asUTC + offsetMin * 60000);
    if (target.getTime() > now.getTime()) return target.toISOString();
  }
  return new Date(now.getTime() + 86400000).toISOString();
}
