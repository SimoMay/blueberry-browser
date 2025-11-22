import { z } from "zod";

/**
 * Pattern type schema
 */
export const PatternTypeSchema = z.enum(["navigation", "form", "copy-paste"]);

/**
 * LLM Analysis Result Schema (Story 1.15)
 * Validates LLM response for pattern detection
 */
export const LLMAnalysisResultSchema = z.object({
  isPattern: z.boolean(),
  confidence: z.number().min(0).max(100),
  intentSummary: z.string().max(200),
  workflow: z
    .object({
      steps: z.array(z.unknown()),
    })
    .nullable(),
  rejectionReason: z.string().nullable(),
});

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
  pattern_id: z.string().min(1, { message: "Pattern ID is required" }),
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
 * Edit automation input schema
 */
export const EditAutomationSchema = z.object({
  automationId: z.string().uuid({ message: "Invalid automation ID format" }),
  name: z
    .string()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be at most 100 characters" }),
  description: z
    .string()
    .max(500, { message: "Description must be at most 500 characters" })
    .optional(),
});

/**
 * Delete automation input schema
 */
export const DeleteAutomationSchema = z.object({
  automationId: z.string().uuid({ message: "Invalid automation ID format" }),
});

/**
 * Copy/Paste event schemas (Story 1.7b)
 */
export const CopyEventSchema = z.object({
  text: z.string(),
  sourceElement: z.string(),
  url: z.string().url({ message: "Invalid source URL" }),
  pageTitle: z.string(),
  timestamp: z.number().int().positive(),
  tabId: z.string(),
});

export const PasteEventSchema = z.object({
  destinationElement: z.string(),
  url: z.string().url({ message: "Invalid destination URL" }),
  pageTitle: z.string(),
  timestamp: z.number().int().positive(),
  tabId: z.string(),
});

/**
 * Proactive suggestion schemas (Story 1.14)
 */
export const SuggestContinuationSchema = z.object({
  patternId: z.string().min(1, { message: "Pattern ID is required" }),
  intentSummary: z.string(),
  estimatedItems: z.number().int().positive(),
  matchCount: z.number().int().min(2),
});

export const StartContinuationSchema = z.object({
  patternId: z.string().min(1, { message: "Pattern ID is required" }),
  itemCount: z.number().int().positive().max(100, {
    message: "Item count must be at most 100",
  }),
});

export const CancelExecutionSchema = z.object({
  executionId: z.string().min(1, { message: "Execution ID is required" }),
});

/**
 * Type exports for TypeScript
 */
export type PatternTrackInput = z.infer<typeof PatternTrackSchema>;
export type PatternGetAllInput = z.infer<typeof PatternGetAllSchema>;
export type SaveAutomationInput = z.infer<typeof SaveAutomationSchema>;
export type ExecuteAutomationInput = z.infer<typeof ExecuteAutomationSchema>;
export type EditAutomationInput = z.infer<typeof EditAutomationSchema>;
export type DeleteAutomationInput = z.infer<typeof DeleteAutomationSchema>;
export type CopyEventInput = z.infer<typeof CopyEventSchema>;
export type PasteEventInput = z.infer<typeof PasteEventSchema>;
export type SuggestContinuationInput = z.infer<
  typeof SuggestContinuationSchema
>;
export type StartContinuationInput = z.infer<typeof StartContinuationSchema>;
export type CancelExecutionInput = z.infer<typeof CancelExecutionSchema>;
export type LLMAnalysisResult = z.infer<typeof LLMAnalysisResultSchema>;
