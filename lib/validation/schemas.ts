import { z } from "zod";

/**
 * Domain-wide Zod schemas. Server actions, form code, and webhook handlers
 * share these so validation, types, and error messages stay in lock-step.
 *
 * Sections:
 *   - Events (create/update/requirements/cancel)
 *   - Staff/roster + roles + qualifications + CSV import
 *   - Provider webhook payloads (Twilio status, Twilio inbound, Resend)
 */

// ─── Events ──────────────────────────────────────────────────────────────

export const OVERBOOKING_POLICIES = [
  "allow_all",
  "waitlist_after_requirement",
] as const;

export type OverbookingPolicy = (typeof OVERBOOKING_POLICIES)[number];

const isoTimestamp = z
  .string()
  .min(1, "Required")
  .refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    "Must be a valid ISO timestamp",
  );

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .or(z.literal("").transform(() => undefined));

export const eventCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title must be 200 characters or fewer"),
    description: optionalText(2000),
    event_type: optionalText(80),
    starts_at: isoTimestamp,
    ends_at: isoTimestamp,
    timezone: z.string().min(1).max(64).default("America/Toronto"),
    location: optionalText(200),
    required_headcount: z
      .number()
      .int("Must be a whole number")
      .min(0, "Cannot be negative")
      .max(500, "Cannot exceed 500"),
    overbooking_policy: z.enum(OVERBOOKING_POLICIES).default("allow_all"),
    manager_notes: optionalText(2000),
  })
  .refine(
    (v) => new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "Event end must be after start", path: ["ends_at"] },
  );

export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const eventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: optionalText(2000),
    event_type: optionalText(80),
    starts_at: isoTimestamp.optional(),
    ends_at: isoTimestamp.optional(),
    timezone: z.string().min(1).max(64).optional(),
    location: optionalText(200),
    required_headcount: z.number().int().min(0).max(500).optional(),
    overbooking_policy: z.enum(OVERBOOKING_POLICIES).optional(),
    manager_notes: optionalText(2000),
  })
  .refine(
    (v) =>
      !v.starts_at ||
      !v.ends_at ||
      new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "Event end must be after start", path: ["ends_at"] },
  );

export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

export const eventRequirementSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(100, "Label must be 100 characters or fewer"),
  required_count: z
    .number()
    .int()
    .min(0, "Cannot be negative")
    .max(100, "Cannot exceed 100"),
  role_id: z.string().uuid().optional().nullable(),
  qualification_id: z.string().uuid().optional().nullable(),
  notes: optionalText(500),
});

export type EventRequirementInput = z.infer<typeof eventRequirementSchema>;

export const cancelEventSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required")
    .max(1000, "Reason must be 1000 characters or fewer"),
});

export type CancelEventInput = z.infer<typeof cancelEventSchema>;

// ─── Attendance / payroll (Phase 7) ──────────────────────────────────────

export const ATTENDANCE_STATUSES = [
  "scheduled",
  "worked",
  "no_show",
  "cancelled_by_member",
  "cancelled_by_manager",
  "excused",
] as const;

export type AttendanceStatusEnum = (typeof ATTENDANCE_STATUSES)[number];

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

/**
 * v2 (Wave B2): YYYY-MM-DD `day_date` used by the per-day attendance matrix.
 * Optional on the action input so legacy single-day callers keep working —
 * when omitted, the server defaults to the event's start day or the
 * assignment's own day.
 */
const attendanceDayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Must be a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
    message: "Must be a valid calendar date",
  })
  .optional();

/** Sets only the status — used by the cycle button on the attendance grid. */
export const attendanceStatusUpdateSchema = z.object({
  eventId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  status: attendanceStatusSchema,
  day_date: attendanceDayDate,
});

export type AttendanceStatusUpdateInput = z.infer<
  typeof attendanceStatusUpdateSchema
>;

/**
 * Per-row detail edit. All payable fields are optional so the popover can
 * patch any subset. Hours capped at 24 per shift (sanity bound — anything
 * longer should be split across shifts); rate at 1000/hr.
 */
export const attendanceUpdateSchema = z.object({
  eventId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  day_date: attendanceDayDate,
  actual_start: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(new Date(s).getTime()),
      "Must be a valid ISO timestamp",
    )
    .optional()
    .nullable(),
  actual_end: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(new Date(s).getTime()),
      "Must be a valid ISO timestamp",
    )
    .optional()
    .nullable(),
  actual_hours: z
    .number()
    .min(0, "Hours cannot be negative")
    .max(24, "Hours cannot exceed 24")
    .optional()
    .nullable(),
  pay_rate: z
    .number()
    .min(0, "Pay rate cannot be negative")
    .max(1000, "Pay rate cannot exceed 1000")
    .optional()
    .nullable(),
  pay_code: z
    .string()
    .trim()
    .max(40, "Pay code is too long")
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(2000, "Notes must be 2000 characters or fewer")
    .optional()
    .nullable(),
});

export type AttendanceUpdateInput = z.infer<typeof attendanceUpdateSchema>;

export const markAllWorkedSchema = z.object({
  eventId: z.string().uuid(),
});

export type MarkAllWorkedInput = z.infer<typeof markAllWorkedSchema>;

export const eventLifecycleSchema = z.object({
  eventId: z.string().uuid(),
});

export type EventLifecycleInput = z.infer<typeof eventLifecycleSchema>;

// ─── Roster / staff / roles / qualifications / CSV ───────────────────────

export const preferredContactSchema = z.enum([
  "sms",
  "email",
  "both",
  "manual_only",
]);
export type PreferredContact = z.infer<typeof preferredContactSchema>;

export const consentSourceSchema = z.enum([
  "verbal",
  "web_form",
  "import",
  "manual",
]);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

/** Allow up to 32-byte phone strings; we normalize to E.164 elsewhere. */
const phoneInputSchema = z
  .string()
  .max(32, { message: "Phone is too long" })
  .or(z.literal(""))
  .optional()
  .nullable();

/** Liberal email shape — strict validation happens via normalize-contact. */
const emailInputSchema = z
  .string()
  .max(254, { message: "Email is too long" })
  .or(z.literal(""))
  .optional()
  .nullable();

/** Shared object shape so create + update can both extend it. */
const staffMemberObjectSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, { message: "Display name is required" })
    .max(80, { message: "Display name is too long" }),
  first_name: z.string().trim().max(40).optional().nullable(),
  last_name: z.string().trim().max(40).optional().nullable(),
  phone: phoneInputSchema,
  email: emailInputSchema,
  preferred_contact: preferredContactSchema.default("both"),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
  role_ids: z.array(z.string().uuid()).default([]),
  primary_role_id: z.string().uuid().optional().nullable(),
  qualification_ids: z.array(z.string().uuid()).default([]),
  consent_sms: z.boolean().default(false),
  consent_sms_source: consentSourceSchema.optional().nullable(),
  consent_email: z.boolean().default(false),
  consent_email_source: consentSourceSchema.optional().nullable(),
});

const primaryRoleInRoleIds = (data: {
  primary_role_id?: string | null;
  role_ids?: string[];
}) =>
  !data.primary_role_id ||
  (data.role_ids ?? []).includes(data.primary_role_id);

const primaryRoleRefine = {
  path: ["primary_role_id"],
  message: "Primary role must be one of the selected roles",
};

export const staffMemberCreateSchema = staffMemberObjectSchema.refine(
  primaryRoleInRoleIds,
  primaryRoleRefine,
);

export type StaffMemberCreateInput = z.infer<typeof staffMemberCreateSchema>;

/**
 * PATCH-style update: all fields optional. Defaults still apply for the
 * boolean/array fields when omitted, so `updateStaffMember` can still read
 * `data.role_ids.length` etc. without null-guards.
 */
export const staffMemberUpdateSchema = staffMemberObjectSchema
  .partial()
  .extend({
    // Re-apply defaults so downstream code can rely on them being present
    // even when the client sent a sparse PATCH payload.
    preferred_contact: preferredContactSchema.default("both"),
    active: z.boolean().default(true),
    role_ids: z.array(z.string().uuid()).default([]),
    qualification_ids: z.array(z.string().uuid()).default([]),
    consent_sms: z.boolean().default(false),
    consent_email: z.boolean().default(false),
  })
  .refine(primaryRoleInRoleIds, primaryRoleRefine);
export type StaffMemberUpdateInput = z.infer<typeof staffMemberUpdateSchema>;

export const csvRowSchema = z.object({
  first_name: z.string().trim().max(40).optional().default(""),
  last_name: z.string().trim().max(40).optional().default(""),
  display_name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().max(254).optional().default(""),
  phone: z.string().trim().max(32).optional().default(""),
  preferred_contact: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((v) => v.toLowerCase()),
  primary_role: z.string().trim().max(60).optional().default(""),
  roles: z.string().trim().optional().default(""),
  qualifications: z.string().trim().optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  active: z.string().trim().optional().default(""),
});

export type CsvRow = z.infer<typeof csvRowSchema>;

export const roleCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional().default(100),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

export const qualificationCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional().nullable(),
});
export type QualificationCreateInput = z.infer<
  typeof qualificationCreateSchema
>;

export const qualificationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});
export type QualificationUpdateInput = z.infer<
  typeof qualificationUpdateSchema
>;

// ─── Invitations & RSVP ──────────────────────────────────────────────────

export const inviteChannelSchema = z.enum(["sms", "email"]);
export type InviteChannel = z.infer<typeof inviteChannelSchema>;

/**
 * Sent by the dashboard invite-flow action when the manager finishes the
 * three-step wizard. The orchestrator (lib/messaging/create-campaign.ts)
 * consumes this schema directly.
 */
export const sendInvitationCampaignSchema = z.object({
  eventId: z.string().uuid({ message: "Invalid event id" }),
  staffMemberIds: z
    .array(z.string().uuid())
    .min(1, { message: "Select at least one responder" })
    .max(500, { message: "Too many recipients in one campaign" }),
  channels: z
    .array(inviteChannelSchema)
    .min(1, { message: "Select at least one channel" }),
  smsTemplate: z.string().max(1600).optional().nullable(),
  emailSubject: z.string().max(200).optional().nullable(),
  emailTemplate: z.string().max(8000).optional().nullable(),
  /**
   * v2: which event days each recipient is being invited for. When omitted
   * the orchestrator defaults to every day in the event window, preserving
   * v1 single-day semantics.
   */
  days: z
    .array(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Must be a YYYY-MM-DD date")
        .refine(
          (s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()),
          "Must be a valid calendar date",
        ),
    )
    .min(1)
    .max(30)
    .optional(),
});
export type SendInvitationCampaignInput = z.infer<
  typeof sendInvitationCampaignSchema
>;

export const RSVP_ACTIONS = ["accept", "decline", "cancel", "update_note"] as const;
export type RsvpActionKind = (typeof RSVP_ACTIONS)[number];

/**
 * ISO date string (YYYY-MM-DD). Used by the per-day RSVP payload — every
 * entry must round-trip through `new Date(...)` to a valid UTC midnight.
 */
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Must be a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
    message: "Must be a valid calendar date",
  });

/**
 * Public RSVP submission — never trust the client.
 *
 * v2: `days` lets responders accept/decline a SUBSET of a multi-day event.
 * The server validates every entry against the event window. If omitted
 * (single-day clients / older invites) the handler falls back to the
 * event's start date.
 */
export const rsvpSubmitSchema = z.object({
  token: z
    .string()
    .min(8, { message: "Invalid RSVP link" })
    .max(200, { message: "Invalid RSVP link" }),
  action: z.enum(RSVP_ACTIONS),
  note: z.string().trim().max(500).optional().nullable(),
  days: z
    .array(isoDateString)
    .min(1, "Pick at least one day")
    .max(30, "Too many days")
    .optional(),
});
export type RsvpSubmitInput = z.infer<typeof rsvpSubmitSchema>;

// ─── Provider webhook payloads ───────────────────────────────────────────

/**
 * Twilio status callback (HTTP form-encoded). Twilio sends a variable set of
 * fields depending on the message type — we only require MessageSid here and
 * accept any string for the other documented fields.
 *
 * https://www.twilio.com/docs/messaging/guides/webhook-request
 */
export const twilioStatusCallbackSchema = z
  .object({
    MessageSid: z.string().min(1),
    MessageStatus: z.string().optional(),
    SmsStatus: z.string().optional(),
    ErrorCode: z.string().optional(),
    ErrorMessage: z.string().optional(),
    To: z.string().optional(),
    From: z.string().optional(),
  })
  .passthrough();

export type TwilioStatusCallbackPayload = z.infer<typeof twilioStatusCallbackSchema>;

/**
 * Twilio inbound SMS (form-encoded). MessageSid + From + Body are the
 * essentials we use to interpret STOP/HELP/START semantics.
 */
export const twilioInboundSchema = z
  .object({
    MessageSid: z.string().min(1),
    From: z.string().min(1),
    To: z.string().optional(),
    Body: z.string().optional(),
  })
  .passthrough();

export type TwilioInboundPayload = z.infer<typeof twilioInboundSchema>;

/**
 * Resend event payload (JSON). The shape is roughly:
 *  { type: "email.delivered", data: { email_id, to, ... }, created_at }
 * https://resend.com/docs/dashboard/webhooks/event-types
 */
export const resendEventSchema = z
  .object({
    type: z.string().min(1),
    data: z
      .object({
        email_id: z.string().optional(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
      })
      .passthrough(),
    created_at: z.string().optional(),
  })
  .passthrough();

export type ResendEventPayload = z.infer<typeof resendEventSchema>;
