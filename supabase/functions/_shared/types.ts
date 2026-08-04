// Minimal shared types for Edge Functions. Kept intentionally small and
// hand-written (rather than importing the frontend's generated types) so
// each function stays independently deployable with no cross-boundary
// bundling risk.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AppSupabaseClient = SupabaseClient;

export type PostRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  image_url: string | null;
  status: string;
  scheduled_at: string | null;
  linkedin_post_id: string | null;
  published_at: string | null;
  schedule_id: string | null;
  content_hash: string | null;
  news_summary: string | null;
  created_at: string;
};

/** One-shot publish queue consumed by `publish-scheduled-posts`. */
export type ScheduledPostRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  image_url: string | null;
  scheduled_at: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | string;
  error_message: string | null;
  linkedin_post_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkedInSettings = {
  linkedin_access_token: string | null;
  linkedin_token_expires_at: string | null;
  linkedin_person_urn: string | null;
  linkedin_organization_id: string | null;
};

export type ScheduleRow = {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  tone_instructions: string | null;
  ai_model: string | null;
  saved_source_ids: string[];
  adhoc_sources: { type: "url" | "keyword" | "idea"; value: string }[];
  days_of_week: number[];
  hour: number;
  minute: number;
  timezone: string;
  image_mode: "none" | "ai";
  image_prompt: string | null;
  enabled: boolean;
  used_urls: string[] | null;
  recent_hashes: string[] | null;
  last_run_at: string | null;
  next_run_at: string | null;
};
