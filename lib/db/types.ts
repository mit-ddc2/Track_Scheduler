/**
 * Database typings — hand-rolled subset for Phase 1.
 *
 * The full `Database` type will be replaced with `supabase gen types typescript`
 * output once we wire up CI for it (Phase 5+). For now we keep just what auth
 * and the dashboard shell touch so RLS-aware client calls are type-checked.
 */

export type Profile = {
  id: string;
  display_name: string;
  email: string;
  is_owner: boolean;
  is_active: boolean;
  phone_for_alerts: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = Omit<Profile, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = Partial<Omit<Profile, "id" | "created_at">>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
