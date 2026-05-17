import { z } from "zod";

/**
 * Event create/update + requirement schemas (Phase 3).
 *
 * Mirrors the constraints on the `events` and `event_requirements` tables in
 * `supabase/migrations/0001_initial_schema.sql` so the server action layer can
 * reject bad input before touching the DB.
 */

export const OVERBOOKING_POLICIES = ["allow_all", "waitlist_after_requirement"] as const;

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
