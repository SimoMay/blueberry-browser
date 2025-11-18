import { z } from "zod";

/**
 * Schema for starting a recording
 */
export const StartRecordingSchema = z.object({
  tabId: z.string(),
});

export type StartRecordingInput = z.infer<typeof StartRecordingSchema>;

/**
 * Schema for saving a recording
 */
export const SaveRecordingSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  actions: z.array(
    z.object({
      type: z.enum(["navigation", "form", "click"]),
      timestamp: z.number(),
      data: z.any(), // Flexible data structure for different action types
    }),
  ),
});

export type SaveRecordingInput = z.infer<typeof SaveRecordingSchema>;
