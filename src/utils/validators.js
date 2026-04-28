const { z } = require("zod");

const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid ISO datetime",
});
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date, expected YYYY-MM-DD");

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.email(),
  password: z.string().min(6).max(72),
  displayName: z.string().max(100).optional(),
  major: z.string().max(100).optional(),
  avatarUrl: z.url().max(500).optional(),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(72),
});

const updateProfileSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  avatarUrl: z.url().max(500).nullable().optional(),
});

const calendarEventSchema = z
  .object({
    title: z.string().max(255).default(""),
    description: z.string().nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    eventType: z.enum(["busy", "available"]).default("busy"),
    isRecurring: z.boolean().default(false),
    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceStartDate: isoDateSchema.nullable().optional(),
    recurrenceEndDate: isoDateSchema.nullable().optional(),
    source: z.enum(["manual", "ai_screenshot", "ai_conversation", "ics_import"]).default("manual"),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "endTime must be later than startTime",
    path: ["endTime"],
  });

const calendarEventUpdateSchema = z
  .object({
    title: z.string().max(255).optional(),
    description: z.string().nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    startTime: isoDateTimeSchema.optional(),
    endTime: isoDateTimeSchema.optional(),
    eventType: z.enum(["busy", "available"]).optional(),
    isRecurring: z.boolean().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceStartDate: isoDateSchema.nullable().optional(),
    recurrenceEndDate: isoDateSchema.nullable().optional(),
    source: z.enum(["manual", "ai_screenshot", "ai_conversation", "ics_import"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required for update",
  })
  .refine((data) => {
    if (!data.startTime || !data.endTime) return true;
    return new Date(data.endTime) > new Date(data.startTime);
  }, {
    message: "endTime must be later than startTime",
    path: ["endTime"],
  });

const createTeamEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  availableStart: isoDateTimeSchema,
  availableEnd: isoDateTimeSchema,
}).refine((data) => new Date(data.availableEnd) > new Date(data.availableStart), {
  message: "availableEnd must be later than availableStart",
  path: ["availableEnd"],
});

const availabilityQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
});

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  calendarEventSchema,
  calendarEventUpdateSchema,
  createTeamEventSchema,
  availabilityQuerySchema,
};
