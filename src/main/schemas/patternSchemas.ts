import { z } from "zod";
import type { PatternId, AutomationId, TabId } from "../types/brandedTypes";
import {
  createPatternId,
  createAutomationId,
  createTabId,
} from "../types/brandedTypes";

/**
 * Pattern type schema
 * Story 1.18 Course Correction: Tab switches are metadata only, not a separate pattern type
 * Cross-tab workflows are saved as their primary type (copy-paste, navigation) with tab metadata
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
 * Uses .transform() to return branded PatternId for type safety
 */
export const SaveAutomationSchema = z.object({
  pattern_id: z
    .string()
    .min(1, { message: "Pattern ID is required" })
    .transform(createPatternId),
  name: z
    .string()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be at most 100 characters" }),
  description: z.string().optional(),
});

/**
 * Execute automation input schema
 * Uses .transform() to return branded AutomationId for type safety
 */
export const ExecuteAutomationSchema = z.object({
  automation_id: z
    .string()
    .uuid({ message: "Invalid automation ID format" })
    .transform(createAutomationId),
});

/**
 * Edit automation input schema
 * Uses .transform() to return branded AutomationId for type safety
 */
export const EditAutomationSchema = z.object({
  automationId: z
    .string()
    .uuid({ message: "Invalid automation ID format" })
    .transform(createAutomationId),
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
 * Uses .transform() to return branded AutomationId for type safety
 */
export const DeleteAutomationSchema = z.object({
  automationId: z
    .string()
    .uuid({ message: "Invalid automation ID format" })
    .transform(createAutomationId),
});

/**
 * Copy/Paste event schemas (Story 1.7b)
 * Uses .transform() to return branded TabId for type safety
 */
export const CopyEventSchema = z.object({
  text: z.string(),
  sourceElement: z.string(),
  url: z.string().url({ message: "Invalid source URL" }),
  pageTitle: z.string(),
  timestamp: z.number().int().positive(),
  tabId: z.string().transform(createTabId),
});

export const PasteEventSchema = z.object({
  destinationElement: z.string(),
  url: z.string().url({ message: "Invalid destination URL" }),
  pageTitle: z.string(),
  timestamp: z.number().int().positive(),
  tabId: z.string().transform(createTabId),
});

/**
 * Proactive suggestion schemas (Story 1.14)
 * Uses .transform() to return branded PatternId for type safety
 */
export const SuggestContinuationSchema = z.object({
  patternId: z
    .string()
    .min(1, { message: "Pattern ID is required" })
    .transform(createPatternId),
  intentSummary: z.string(),
  estimatedItems: z.number().int().positive(),
  matchCount: z.number().int().min(2),
});

export const StartContinuationSchema = z.object({
  patternId: z
    .string()
    .min(1, { message: "Pattern ID is required" })
    .transform(createPatternId),
  itemCount: z.number().int().positive().max(100, {
    message: "Item count must be at most 100",
  }),
});

export const CancelExecutionSchema = z.object({
  executionId: z.string().min(1, { message: "Execution ID is required" }),
});

/**
 * Dismiss pattern input schema
 * Uses .transform() to return branded PatternId for type safety
 */
export const DismissPatternSchema = z.object({
  patternId: z
    .string()
    .min(1, { message: "Pattern ID is required" })
    .transform(createPatternId),
});

/**
 * Start workflow refinement input schema
 * Uses .transform() to return branded AutomationId for type safety
 */
export const StartRefinementSchema = z.object({
  automationId: z
    .string()
    .uuid({ message: "Invalid automation ID format" })
    .transform(createAutomationId),
});

/**
 * LLM Execution Step Schema (Story 1.16)
 * Validates LLM response for automation execution
 * Note: target can be null when nextAction is "complete" or "extract"
 * "extract" action: Auto-extracts headings/text from current page (no clicking required)
 * "press" action: Press a keyboard key (value = "Enter", "Escape", "Tab", etc.)
 */
export const LLMExecutionStepSchema = z.object({
  nextAction: z.enum([
    "click",
    "type",
    "navigate",
    "wait",
    "complete",
    "extract",
    "press", // Press a keyboard key (e.g., "Enter" to submit forms)
  ]),
  target: z.string().nullable(), // For "press": element selector to focus first (optional)
  value: z.string().nullable(), // For "press": key name (e.g., "Enter", "Escape", "Tab")
  reasoning: z.string(),
  isComplete: z.boolean(),
  estimatedStepsRemaining: z.number().nullable(),
});

/**
 * Type exports for TypeScript (with branded types for type safety)
 */
export type PatternTrackInput = z.infer<typeof PatternTrackSchema>;
export type PatternGetAllInput = z.infer<typeof PatternGetAllSchema>;

// Override Zod inference to use branded types for IDs
export type SaveAutomationInput = Omit<
  z.infer<typeof SaveAutomationSchema>,
  "pattern_id"
> & {
  pattern_id: PatternId;
};

export type ExecuteAutomationInput = Omit<
  z.infer<typeof ExecuteAutomationSchema>,
  "automation_id"
> & {
  automation_id: AutomationId;
};

export type EditAutomationInput = Omit<
  z.infer<typeof EditAutomationSchema>,
  "automationId"
> & {
  automationId: AutomationId;
};

export type DeleteAutomationInput = Omit<
  z.infer<typeof DeleteAutomationSchema>,
  "automationId"
> & {
  automationId: AutomationId;
};

export type CopyEventInput = Omit<z.infer<typeof CopyEventSchema>, "tabId"> & {
  tabId: TabId;
};

export type PasteEventInput = Omit<
  z.infer<typeof PasteEventSchema>,
  "tabId"
> & {
  tabId: TabId;
};

export type SuggestContinuationInput = Omit<
  z.infer<typeof SuggestContinuationSchema>,
  "patternId"
> & {
  patternId: PatternId;
};

export type StartContinuationInput = Omit<
  z.infer<typeof StartContinuationSchema>,
  "patternId"
> & {
  patternId: PatternId;
};

// CancelExecutionInput keeps executionId as string (not a domain ID type)
export type CancelExecutionInput = z.infer<typeof CancelExecutionSchema>;

export type LLMAnalysisResult = z.infer<typeof LLMAnalysisResultSchema>;
export type LLMExecutionStep = z.infer<typeof LLMExecutionStepSchema>;
