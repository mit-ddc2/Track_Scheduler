/**
 * Database typings — hand-rolled subset.
 *
 * The full `Database` type will be replaced with `supabase gen types typescript`
 * output once we wire up CI for it. For now we keep just what auth, events,
 * notifications, audit, roster, and messaging touch so RLS-aware client calls
 * are type-checked.
 */

// ─── Enums shared across the app ─────────────────────────────────────────

export type PreferredContactMethod = "sms" | "email" | "both" | "manual_only";
export type ContactChannel = "sms" | "email";
export type ContactStatus =
  | "unknown"
  | "valid"
  | "invalid"
  | "bounced"
  | "suppressed"
  | "opted_out";
export type ConsentStatus = "unknown" | "granted" | "denied" | "withdrawn";

// ─── Profile ─────────────────────────────────────────────────────────────

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

// ─── Roster ──────────────────────────────────────────────────────────────

export type CrewRole = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Qualification = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffMember = {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  preferred_contact: PreferredContactMethod;
  active: boolean;
  notes: string | null;
  imported_source: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type StaffMemberInsert = {
  id?: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_contact?: PreferredContactMethod;
  active?: boolean;
  notes?: string | null;
  imported_source?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
};

export type StaffMemberUpdate = {
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_contact?: PreferredContactMethod;
  active?: boolean;
  notes?: string | null;
  updated_by?: string | null;
  updated_at?: string;
  archived_at?: string | null;
};

export type StaffContactMethod = {
  id: string;
  staff_member_id: string;
  channel: ContactChannel;
  value: string;
  normalized_value: string;
  is_primary: boolean;
  status: ContactStatus;
  consent: ConsentStatus;
  consent_source: string | null;
  consented_at: string | null;
  opted_out_at: string | null;
  last_verified_at: string | null;
  last_delivery_status: string | null;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffRole = {
  staff_member_id: string;
  role_id: string;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
};

export type StaffQualification = {
  staff_member_id: string;
  qualification_id: string;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
};

export type ConsentRecord = {
  id: string;
  staff_member_id: string;
  contact_method_id: string | null;
  channel: ContactChannel;
  status: ConsentStatus;
  source: string;
  captured_by: string | null;
  captured_at: string;
  notes: string | null;
  evidence: Record<string, unknown>;
};

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
// IMPORTANT: the column is `actor_user_id`, not `actor_id`.

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

// ─── Messaging ───────────────────────────────────────────────────────────

export type OutboxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type InviteStatus =
  | "created"
  | "invited"
  | "accepted"
  | "declined"
  | "cancelled_by_member"
  | "cancelled_by_manager"
  | "availability_updated"
  | "expired"
  | "waitlisted";

export type MessageOutboxRow = {
  id: string;
  campaign_id: string | null;
  invite_id: string | null;
  manager_notification_id: string | null;
  staff_member_id: string | null;
  channel: ContactChannel;
  to_value: string;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  provider: string;
  provider_message_id: string | null;
  idempotency_key: string;
  status: OutboxStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
};

export type MessageOutboxInsert = Partial<MessageOutboxRow> & {
  channel: ContactChannel;
  to_value: string;
  body_text: string;
  provider: string;
  idempotency_key: string;
};

export type MessageOutboxUpdate = Partial<Omit<MessageOutboxRow, "id">>;

export type MessageEventRow = {
  id: string;
  message_outbox_id: string | null;
  provider: string;
  provider_message_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  received_at: string;
};

export type MessageEventInsert = Partial<MessageEventRow> & {
  provider: string;
  event_type: string;
};

export type RsvpTokenRow = {
  id: string;
  invite_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type RsvpTokenInsert = {
  invite_id: string;
  token_hash: string;
  expires_at: string;
  used_at?: string | null;
};

// ─── Event assignments + attendance (Phase 7) ────────────────────────────

export type AssignmentStatus =
  | "confirmed"
  | "waitlisted"
  | "cancelled"
  | "completed";

export type EventAssignmentRow = {
  id: string;
  event_id: string;
  staff_member_id: string;
  invite_id: string | null;
  status: AssignmentStatus;
  role_id: string | null;
  role_label: string | null;
  requirement_id: string | null;
  counts_toward_headcount: boolean;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceStatus =
  | "scheduled"
  | "worked"
  | "no_show"
  | "cancelled_by_member"
  | "cancelled_by_manager"
  | "excused";

export type AttendanceRecordRow = {
  id: string;
  event_id: string;
  staff_member_id: string;
  assignment_id: string | null;
  status: AttendanceStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  actual_hours: number | null;
  pay_rate: number | null;
  pay_code: string | null;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceRecordInsert = {
  id?: string;
  event_id: string;
  staff_member_id: string;
  assignment_id?: string | null;
  status?: AttendanceStatus;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  actual_hours?: number | null;
  pay_rate?: number | null;
  pay_code?: string | null;
  notes?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
};

export type AttendanceRecordUpdate = Partial<
  Omit<AttendanceRecordRow, "id" | "event_id" | "staff_member_id" | "created_at">
>;

// ─── Mock SMS log (dev / E2E only) ───────────────────────────────────────

export type MockSentSmsRow = {
  id: string;
  to_value: string;
  body: string;
  provider_message_id: string;
  created_at: string;
};

export type MockSentSmsInsert = {
  id?: string;
  to_value: string;
  body: string;
  provider_message_id: string;
  created_at?: string;
};

type Rel = [];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: Rel;
      };
      crew_roles: {
        Row: CrewRole;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: Rel;
      };
      qualifications: {
        Row: Qualification;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: Rel;
      };
      staff_members: {
        Row: StaffMember;
        Insert: StaffMemberInsert;
        Update: StaffMemberUpdate;
        Relationships: Rel;
      };
      staff_contact_methods: {
        Row: StaffContactMethod;
        Insert: {
          id?: string;
          staff_member_id: string;
          channel: ContactChannel;
          value: string;
          normalized_value: string;
          is_primary?: boolean;
          status?: ContactStatus;
          consent?: ConsentStatus;
          consent_source?: string | null;
          consented_at?: string | null;
          opted_out_at?: string | null;
          last_verified_at?: string | null;
          last_delivery_status?: string | null;
          last_delivery_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<StaffContactMethod>;
        Relationships: Rel;
      };
      staff_roles: {
        Row: StaffRole;
        Insert: {
          staff_member_id: string;
          role_id: string;
          is_primary?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<StaffRole>;
        Relationships: Rel;
      };
      staff_qualifications: {
        Row: StaffQualification;
        Insert: {
          staff_member_id: string;
          qualification_id: string;
          notes?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: Partial<StaffQualification>;
        Relationships: Rel;
      };
      consent_records: {
        Row: ConsentRecord;
        Insert: {
          id?: string;
          staff_member_id: string;
          contact_method_id?: string | null;
          channel: ContactChannel;
          status: ConsentStatus;
          source: string;
          captured_by?: string | null;
          captured_at?: string;
          notes?: string | null;
          evidence?: Record<string, unknown>;
        };
        Update: Partial<ConsentRecord>;
        Relationships: Rel;
      };
      events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: EventUpdate;
        Relationships: Rel;
      };
      event_requirements: {
        Row: EventRequirementRow;
        Insert: EventRequirementInsert;
        Update: Partial<EventRequirementRow>;
        Relationships: Rel;
      };
      manager_notifications: {
        Row: ManagerNotification;
        Insert: ManagerNotificationInsert;
        Update: ManagerNotificationUpdate;
        Relationships: Rel;
      };
      notification_preferences: {
        Row: NotificationPreference;
        Insert: NotificationPreferenceInsert;
        Update: NotificationPreferenceUpdate;
        Relationships: Rel;
      };
      audit_log: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        Update: Partial<AuditLogRow>;
        Relationships: Rel;
      };
      message_outbox: {
        Row: MessageOutboxRow;
        Insert: MessageOutboxInsert;
        Update: MessageOutboxUpdate;
        Relationships: Rel;
      };
      message_events: {
        Row: MessageEventRow;
        Insert: MessageEventInsert;
        Update: Partial<MessageEventRow>;
        Relationships: Rel;
      };
      rsvp_tokens: {
        Row: RsvpTokenRow;
        Insert: RsvpTokenInsert;
        Update: Partial<RsvpTokenRow>;
        Relationships: Rel;
      };
      event_assignments: {
        Row: EventAssignmentRow;
        Insert: Partial<EventAssignmentRow> & {
          event_id: string;
          staff_member_id: string;
        };
        Update: Partial<EventAssignmentRow>;
        Relationships: Rel;
      };
      attendance_records: {
        Row: AttendanceRecordRow;
        Insert: AttendanceRecordInsert;
        Update: AttendanceRecordUpdate;
        Relationships: Rel;
      };
      mock_sent_sms: {
        Row: MockSentSmsRow;
        Insert: MockSentSmsInsert;
        Update: Partial<MockSentSmsRow>;
        Relationships: Rel;
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_event_requirements_tx: {
        Args: { p_event_id: string; p_requirements: unknown };
        Returns: void;
      };
      update_staff_relations_tx: {
        Args: {
          p_staff_id: string;
          p_contact_methods: unknown;
          p_role_ids: string[];
          p_primary_role_id: string | null;
          p_qualification_ids: unknown;
        };
        Returns: void;
      };
    };
    Enums: {
      preferred_contact_method: PreferredContactMethod;
      contact_channel: ContactChannel;
      contact_status: ContactStatus;
      consent_status: ConsentStatus;
      event_status: EventStatus;
      event_source_type: EventSourceType;
      notification_severity: NotificationSeverity;
      notification_status: NotificationStatus;
      outbox_status: OutboxStatus;
      invite_status: InviteStatus;
      assignment_status: AssignmentStatus;
      attendance_status: AttendanceStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
