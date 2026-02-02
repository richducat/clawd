export type InitialUser = { display_name?: string; xp?: number; level?: number };

export type InitialProfile = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  goal?: string | null;
  activity_level?: string | null;
  schedule_days?: string[];
  nutrition_rating?: number | null;
  injuries_json?: unknown;
} | null;
