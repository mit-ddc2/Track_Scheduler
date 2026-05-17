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

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      notification_severity: NotificationSeverity;
      notification_status: NotificationStatus;
    };
  };
};
