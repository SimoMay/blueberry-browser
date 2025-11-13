import { z } from "zod";

/**
 * Monitor frequency schema
 */
export const MonitorFrequencySchema = z.enum(["1h", "2h", "4h", "6h"], {
  message: "Frequency must be 1h, 2h, 4h, or 6h",
});

/**
 * Monitor status schema
 */
export const MonitorStatusSchema = z.enum(["active", "paused", "error"]);

/**
 * Monitor create input schema
 */
export const MonitorCreateSchema = z.object({
  url: z.string().url({ message: "Invalid URL format" }),
  goal: z.string().optional(),
  frequency: MonitorFrequencySchema,
});

/**
 * Monitor update input schema (pause/resume)
 */
export const MonitorUpdateSchema = z.object({
  id: z.string().min(1, { message: "Monitor ID is required" }),
});

/**
 * Monitor delete input schema
 */
export const MonitorDeleteSchema = z.object({
  id: z.string().min(1, { message: "Monitor ID is required" }),
});

/**
 * Monitor get all input schema (optional filters)
 */
export const MonitorGetAllSchema = z
  .object({
    status: MonitorStatusSchema.optional(),
  })
  .optional();

/**
 * Type exports for TypeScript
 */
export type MonitorFrequency = z.infer<typeof MonitorFrequencySchema>;
export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
export type MonitorCreateInput = z.infer<typeof MonitorCreateSchema>;
export type MonitorUpdateInput = z.infer<typeof MonitorUpdateSchema>;
export type MonitorDeleteInput = z.infer<typeof MonitorDeleteSchema>;
export type MonitorGetAllInput = z.infer<typeof MonitorGetAllSchema>;
