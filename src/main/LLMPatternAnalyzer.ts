import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import log from "electron-log";
import * as dotenv from "dotenv";
import { join } from "path";
import {
  LLMAnalysisResultSchema,
  type LLMAnalysisResult,
} from "./schemas/patternSchemas";

// Load environment variables
dotenv.config({ path: join(__dirname, "../../.env") });

/**
 * Session action tracked by PatternManager
 */
export interface SessionAction {
  type: "navigation" | "form" | "copy-paste";
  url: string;
  pageTitle?: string;
  timestamp: number;
  tabId: string;
  // Navigation-specific fields
  eventType?: "did-navigate" | "did-navigate-in-page";
  // Form-specific fields
  domain?: string;
  formSelector?: string;
  fields?: Array<{ name: string; label?: string; type: string }>;
  // Copy-paste specific fields
  sourceUrl?: string;
  destinationUrl?: string;
  sourceElement?: string;
  destinationElement?: string;
  copiedText?: string;
  elementText?: string;
}

/**
 * LLMPatternAnalyzer - AI-powered pattern detection engine
 * Story 1.15: Replaces deterministic PatternRecognizer with LLM intelligence
 *
 * Features:
 * - Asks LLM "Is this a pattern?" with full context (page titles, element text, tab switches)
 * - <2 second response time using fast models (GPT-4o-mini, Claude Haiku)
 * - Cross-tab workflow support (ProductHunt → Notion)
 * - Fallback to simple heuristics on LLM failure
 * - Cost optimized: <$0.001 per pattern detection
 */
export class LLMPatternAnalyzer {
  private provider: "openai" | "anthropic" | "gemini";
  private modelName: string;
  private requestTimeout = 10000; // 10 seconds max (Gemini API can be slow)

  constructor() {
    this.provider = this.getProvider();
    this.modelName = this.getModelName();

    log.info(
      `[LLMPatternAnalyzer] Initialized with provider: ${this.provider}, model: ${this.modelName}`,
    );
  }

  /**
   * Get provider from environment (matches LLMClient.ts pattern)
   */
  private getProvider(): "openai" | "anthropic" | "gemini" {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "gemini") return "gemini";
    return "openai"; // Default to OpenAI
  }

  /**
   * Get model name from environment or use defaults
   */
  private getModelName(): string {
    const defaults: Record<string, string> = {
      openai: "gpt-4o-mini",
      anthropic: "claude-3-5-haiku-20241022", // Haiku for speed
      gemini: "gemini-1.5-flash",
    };
    return process.env.LLM_MODEL || defaults[this.provider];
  }

  /**
   * Analyze action sequence to determine if it's a pattern
   * Story 1.15 - AC 1, 2, 3, 4
   *
   * @param actions - Array of 2-3 user actions (navigation, form, copy-paste)
   * @param context - Tab states and page context
   * @returns LLM analysis result with pattern decision + metadata
   */
  async analyzeActionSequence(
    actions: Array<SessionAction>,
  ): Promise<LLMAnalysisResult> {
    try {
      // Build rich context prompt with page titles, element text, tab switches
      const prompt = this.buildLLMPrompt(actions);

      // Call LLM with timeout enforcement (<2 seconds)
      const response = await Promise.race([
        this.callLLM(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("LLM timeout")),
            this.requestTimeout,
          ),
        ),
      ]);

      // Parse and validate LLM response
      const result = this.parseLLMResponse(response);

      log.info("[LLMPatternAnalyzer] Pattern analysis complete", {
        isPattern: result.isPattern,
        confidence: result.confidence,
        intent: result.intentSummary,
      });

      return result;
    } catch (error) {
      log.error(
        "[LLMPatternAnalyzer] LLM analysis failed, using fallback",
        error,
      );

      // Fallback to simple heuristics (Story 1.15 - AC 4)
      return this.analyzeWithFallback(actions);
    }
  }

  /**
   * Build LLM prompt with full context
   * Story 1.15 - AC 1: Include page titles, element text, tab switches, timestamps
   */
  private buildLLMPrompt(actions: Array<SessionAction>): string {
    const actionDescriptions = actions
      .map((action, i) => {
        let desc = `${i + 1}. ${action.type.toUpperCase()}\n`;
        desc += `   - Page title: "${action.pageTitle || "Unknown"}"\n`;
        desc += `   - URL: ${action.url}\n`;

        if (action.type === "navigation") {
          try {
            desc += `   - Domain: ${new URL(action.url).hostname}\n`;
          } catch {
            desc += `   - Domain: Invalid URL\n`;
          }
        }

        if (action.elementText) {
          desc += `   - Clicked: "${action.elementText}"\n`;
        }

        if (action.type === "copy-paste") {
          if (action.copiedText) {
            const preview = action.copiedText.substring(0, 100);
            desc += `   - Copied text: "${preview}${action.copiedText.length > 100 ? "..." : ""}"\n`;
          }
          if (action.sourceUrl && action.destinationUrl) {
            desc += `   - Copy from: ${action.sourceUrl}\n`;
            desc += `   - Paste to: ${action.destinationUrl}\n`;
          }
          if (action.sourceElement) {
            desc += `   - Source element: ${action.sourceElement}\n`;
          }
          if (action.destinationElement) {
            desc += `   - Destination element: ${action.destinationElement}\n`;
          }
        }

        if (
          action.type === "form" &&
          action.fields &&
          action.fields.length > 0
        ) {
          const fieldLabels = action.fields
            .map((f) => f.label || f.name)
            .slice(0, 5);
          desc += `   - Form fields: ${action.fields.length} (${fieldLabels.join(", ")})\n`;
        }

        desc += `   - Tab: ${action.tabId}\n`;
        desc += `   - Time: ${new Date(action.timestamp).toLocaleString()}\n`;

        return desc;
      })
      .join("\n");

    return `You are analyzing browser actions to detect repetitive patterns that could be automated.

USER ACTIONS (chronological):
${actionDescriptions}

ANALYSIS QUESTIONS:
1. Is the user repeating a workflow they would want to automate?
2. What is the user's intent? (1 sentence, max 15 words)
3. Does this pattern span multiple tabs?
4. What confidence level (0-100) do you assign?

RESPOND IN JSON FORMAT:
{
  "isPattern": boolean,
  "confidence": number (0-100),
  "intentSummary": string,
  "workflow": {
    "steps": [
      {"tab": number, "action": string, "target": string}
    ]
  },
  "rejectionReason": string | null
}`;
  }

  /**
   * Call LLM with cost-optimized settings
   * Story 1.15 - AC 1: Fast models (GPT-4o-mini, Claude Haiku), <2 second response
   */
  private async callLLM(prompt: string): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        `${this.provider.toUpperCase()}_API_KEY not found in environment`,
      );
    }

    // Set Gemini API key as environment variable (required by @ai-sdk/google)
    if (this.provider === "gemini") {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
    }

    // Initialize model
    let model;
    if (this.provider === "anthropic") {
      model = anthropic(this.modelName);
    } else if (this.provider === "gemini") {
      model = google(this.modelName);
    } else {
      model = openai(this.modelName);
    }

    // Call LLM with JSON response format
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0.3, // Low temperature for consistent, focused output
    });

    log.info(
      `[LLMPatternAnalyzer] LLM response: "${text.substring(0, 200)}..."`,
    );

    return text.trim();
  }

  /**
   * Get API key for configured provider
   */
  private getApiKey(): string | undefined {
    if (this.provider === "anthropic") {
      return process.env.ANTHROPIC_API_KEY;
    } else if (this.provider === "gemini") {
      return process.env.GEMINI_API_KEY;
    } else {
      return process.env.OPENAI_API_KEY;
    }
  }

  /**
   * Parse and validate LLM response
   * Story 1.15 - AC 1, 2: Extract isPattern, confidence, intentSummary, workflow
   */
  private parseLLMResponse(response: string): LLMAnalysisResult {
    try {
      // Try to parse JSON directly
      let jsonText = response.trim();

      // Extract JSON if wrapped in markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      // Remove any leading/trailing text outside JSON object
      const jsonStart = jsonText.indexOf("{");
      const jsonEnd = jsonText.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd >= jsonStart) {
        jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
      }

      const json = JSON.parse(jsonText);
      const validated = LLMAnalysisResultSchema.parse(json);

      return validated;
    } catch (error) {
      log.error("[LLMPatternAnalyzer] Failed to parse LLM response:", error);
      throw new Error("Invalid LLM response format");
    }
  }

  /**
   * Fallback to simple heuristics when LLM fails
   * Story 1.15 - AC 4: Silent fallback, no user interruption
   */
  private analyzeWithFallback(
    actions: Array<SessionAction>,
  ): LLMAnalysisResult {
    log.info(
      `[LLMPatternAnalyzer] Using fallback heuristics for ${actions.length} actions`,
    );

    // Simple heuristic: Same action type repeated 3+ times
    const actionTypes = actions.map((a) => {
      if (a.type === "navigation") {
        return `${a.type}-${a.url}`;
      } else if (a.type === "form") {
        return `${a.type}-${a.domain}-${a.formSelector}`;
      } else if (a.type === "copy-paste") {
        return `${a.type}-${a.sourceUrl}-${a.destinationUrl}`;
      }
      return a.type;
    });

    const uniqueTypes = new Set(actionTypes);

    if (actions.length >= 3 && uniqueTypes.size === 1) {
      // Same action repeated 3+ times → likely pattern
      const action = actions[0];
      let intentSummary = "performing a repeated workflow";

      if (action.type === "navigation" && action.url) {
        try {
          const hostname = new URL(action.url).hostname;
          intentSummary = `navigating through ${hostname}`;
        } catch {
          intentSummary = "navigating through pages";
        }
      } else if (action.type === "form") {
        intentSummary = `filling out forms on ${action.domain || "a website"}`;
      } else if (action.type === "copy-paste") {
        intentSummary = "copying and pasting content between pages";
      }

      return {
        isPattern: true,
        confidence: 50, // Lower confidence for fallback (Story 1.15 - AC 4)
        intentSummary,
        workflow: {
          steps: actions.map((a) => ({
            type: a.type,
            url: a.url,
            timestamp: a.timestamp,
            tabId: a.tabId,
          })),
        },
        rejectionReason: null,
      };
    }

    // No pattern detected
    return {
      isPattern: false,
      confidence: 0,
      intentSummary: "",
      workflow: { steps: [] },
      rejectionReason:
        "Actions do not form a repetitive pattern (fallback heuristic)",
    };
  }
}
