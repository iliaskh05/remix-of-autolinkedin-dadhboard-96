// Shared schedule helpers, used by both the Composer (creating a recurring
// automation) and the Schedules page (displaying existing ones). Keeping this
// in one place avoids the two pages drifting apart over time.

export const DAYS = [
  { v: 1, label: "Lun" },
  { v: 2, label: "Mar" },
  { v: 3, label: "Mer" },
  { v: 4, label: "Jeu" },
  { v: 5, label: "Ven" },
  { v: 6, label: "Sam" },
  { v: 7, label: "Dim" },
] as const;

const WEEKDAY_MAP: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Client-side preview of the next run time for a recurring schedule.
 * This mirrors the authoritative logic in `supabase/functions/run-schedules`
 * (Deno can't share a TS module with the Vite app across runtimes), so any
 * change here should be mirrored there too. Used only for display purposes
 * (e.g. "next run at ..." in the automation dialog) — the server always
 * recomputes the real value on each run.
 */
export function computeNextRunISO(days: number[], hour: number, minute: number, tz: string): string {
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const c = new Date(now.getTime() + i * 86400000);
    const wdName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(c);
    if (!days.includes(WEEKDAY_MAP[wdName])) continue;
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
