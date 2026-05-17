/**
 * Database typings — hand-rolled subset.
 *
 * The full `Database` type will be replaced with `supabase gen types typescript`
 * output once we wire up CI for it. For now we keep just what auth, the
 * dashboard shell, events, and notifications touch so RLS-aware client calls
 * are type-checked.
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

// ─── Events ──────────────────────────────────────────────────────────────

export type EventStatus =
  | "draft"
  | "scheduled"
  | "inviting"
  | "underfilled"
  | "staffed"
  | "needs_review"
  | "locked"
  | "completed"
  | "cancelled";

export type EventSourceType = "manual" | "google_calendar" | "ics_feed";

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string | null;
  status: EventStatus;
  source_type: EventSourceType;
  calendar_source_id: string | null;
  source_event_id: string | null;
  source_etag: string | null;
  source_updated_at: string | null;
  last_source_seen_at: string | null;
  source_hash: string | null;
  review_required: boolean;
  required_headcount: number;
  overbooking_policy: string;
  manager_notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
};

export type EventInsert = {
  title: string;
  description?: string | null;
  event_type?: string | null;
  starts_at: string;
  ends_at: string;
  timezone?: string;
  location?: string | null;
  status?: EventStatus;
  source_type?: EventSourceType;
  required_headcount?: number;
  overbooking_policy?: string;
  manager_notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

export type EventUpdate = Partial<
  Omit<EventRow, "id" | "created_at" | "updated_at">
>;

export type EventRequirementRow = {
  id: string;
  event_id: string;
  label: string;
  required_count: number;
  role_id: string | null;
  qualification_id: string | null;
  notes: string | null;
  created_at: string;
};

export type EventRequirementInsert = Omit<EventRequirementRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

// ─── Notifications ───────────────────────────────────────────────────────

export type NotificationSeverity = "info" | "warning" | "urgent";
export type NotificationStatus = "unread" | "read" | "archived";

export type ManagerNotification = {
  id: string;
  profile_id: string;
  severity: NotificationSeverity;
  status: NotificationStatus;
  event_type: string;
  title: string;
  body: string | null;
  event_id: string | null;
  staff_member_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  dedupe_key: string | null;
  created_at: string;
  read_at: string | null;
};

export type ManagerNotificationInsert = {
  id?: string;
  profile_id: string;
  severity?: NotificationSeverity;
  status?: NotificationStatus;
  event_type: string;
  title: string;
  body?: string | null;
  event_id?: string | null;
  staff_member_id?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  dedupe_key?: string | null;
  created_at?: string;
  read_at?: string | null;
};

export type ManagerNotificationUpdate = Partial<
  Omit<ManagerNotification, "id" | "profile_id" | "created_at">
>;

export type NotificationPreference = {
  id: string;
  profile_id: string;
  event_type: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  minimum_sms_severity: NotificationSeverity;
  minimum_email_severity: NotificationSeverity;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationPreferenceInsert = {
  id?: string;
  profile_id: string;
  event_type: string;
  in_app_enabled?: boolean;
  email_enabled?: boolean;
  sms_enabled?: boolean;
  minimum_sms_severity?: NotificationSeverity;
  minimum_email_severity?: NotificationSeverity;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type NotificationPreferenceUpdate = Partial<
  Omit<NotificationPreference, "id" | "profile_id" | "created_at">
>;

// ─── Audit log ───────────────────────────────────────────────────────────
// Mirrors the `audit_log` table from supabase/migrations/0001_initial_schema.sql.
// IMPORTANT: the column is `actor_user_id`, not `actor_id`. A mistake here
// would silently 500 every audit insert once SUPABASE_SECRET_KEY is set.

export type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_at: string;
};

export type AuditLogInsert = {
  id?: string;
  actor_user_id?: string | null;
  actor_type?: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  request_id?: string | null;
  created_at?: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: EventUpdate;
        Relationships: [];
      };
      event_requirements: {
        Row: EventRequirementRow;
        Insert: EventRequirementInsert;
        Update: Partial<EventRequirementRow>;
        Relationships: [];
      };
      manager_notifications: {
        Row: ManagerNotification;
        Insert: ManagerNotificationInsert;
        Update: ManagerNotificationUpdate;
        Relationships: [];
      };
      notification_preferences: {
        Row: NotificationPreference;
        Insert: NotificationPreferenceInsert;
        Update: NotificationPreferenceUpdate;
        Relationships: [];
      };
      audit_log: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        Update: Partial<AuditLogRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_event_requirements_tx: {
        Args: { p_event_id: string; p_requirements: unknown };
        Returns: void;
      };
    };
    Enums: {
      event_status: EventStatus;
      event_source_type: EventSourceType;
      notification_severity: NotificationSeverity;
      notification_status: NotificationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
