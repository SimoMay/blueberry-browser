import { z } from "zod";

/**
 * Pattern type schema
 */
export const PatternTypeSchema = z.enum(["navigation", "form", "copy-paste"]);

/**
 * Pattern track input schema
 */
export const PatternTrackSchema = z.object({
  type: PatternTypeSchema,
  pattern_data: z.string().min(1, { message: "Pattern data is required" }),
  confidence: z
    .number()
    .min(0, { message: "Confidence must be at least 0" })
    .max(1, { message: "Confidence must be at most 1" }),
});

/**
 * Pattern get all input schema (optional filters)
 */
export const PatternGetAllSchema = z
  .object({
    type: PatternTypeSchema.optional(),
  })
  .optional();

/**
 * Save automation input schema
 */
export const SaveAutomationSchema = z.object({
  pattern_id: z.string().uuid({ message: "Invalid pattern ID format" }),
  name: z
    .string()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be at most 100 characters" }),
  description: z.string().optional(),
});

/**
 * Execute automation input schema
 */
export const ExecuteAutomationSchema = z.object({
  automation_id: z.string().uuid({ message: "Invalid automation ID format" }),
});

/**
 * Type exports for TypeScript
 */
export type PatternTrackInput = z.infer<typeof PatternTrackSchema>;
export type PatternGetAllInput = z.infer<typeof PatternGetAllSchema>;
export type SaveAutomationInput = z.infer<typeof SaveAutomationSchema>;
export type ExecuteAutomationInput = z.infer<typeof ExecuteAutomationSchema>;
