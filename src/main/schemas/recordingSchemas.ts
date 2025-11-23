import { z } from "zod";
import type { TabId } from "../types/brandedTypes";

/**
 * Schema for starting a recording
 */
export const StartRecordingSchema = z.object({
  tabId: z.string(),
});

// Override Zod inference to use branded TabId
export type StartRecordingInput = Omit<
  z.infer<typeof StartRecordingSchema>,
  "tabId"
> & {
  tabId: TabId;
};

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
