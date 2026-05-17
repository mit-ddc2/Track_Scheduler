import { z } from "zod";

/**
 * Domain-wide Zod schemas. Server actions and form code share these so
 * validation, types, and error messages stay in lock-step.
 *
 * Sections:
 *   - Events (create/update/requirements/cancel) — Phase 3
 *   - Staff/roster + roles + qualifications + CSV import — Phase 2
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

export const staffMemberCreateSchema = z
  .object({
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
  })
  .refine(
    (data) =>
      !data.primary_role_id || data.role_ids.includes(data.primary_role_id),
    {
      path: ["primary_role_id"],
      message: "Primary role must be one of the selected roles",
    },
  );

export type StaffMemberCreateInput = z.infer<typeof staffMemberCreateSchema>;

export const staffMemberUpdateSchema = staffMemberCreateSchema;
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
