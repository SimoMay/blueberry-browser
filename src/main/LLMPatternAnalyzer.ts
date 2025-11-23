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
  type: "navigation" | "form" | "copy-paste" | "tab_switch";
  url?: string;
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
  // Tab switch specific fields (Story 1.18)
  fromTabId?: string;
  fromTitle?: string;
  fromUrl?: string;
  toTabId?: string;
  toTitle?: string;
  toUrl?: string;
}

/**
 * LLMPatternAnalyzer - AI-powered pattern detection engine
 * Story 1.15: Replaces deterministic PatternRecognizer with LLM intelligence
 * Updated Story 1.19: Remove Template Fallbacks (LLM-only, no heuristics)
 *
 * Features:
 * - Asks LLM "Is this a pattern?" with full context (page titles, element text, tab switches)
 * - <30 second timeout (Gemini API can be slow, cross-tab analysis needs time)
 * - Cross-tab workflow support (ProductHunt → Notion)
 * - Exponential backoff retry on LLM failure (3 attempts: 2s, 4s, 8s delays)
 * - NO fallback heuristics - pattern detection fails if LLM unavailable
 * - Cost optimized: <$0.001 per pattern detection
 */
export class LLMPatternAnalyzer {
  private provider: "openai" | "anthropic" | "gemini";
  private modelName: string;
  private requestTimeout = 30000; // 30 seconds max (Gemini API can be slow, cross-tab analysis needs more time)

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
   * Story 1.15 - AC 1, 2, 3
   * Story 1.19 - AC 2, 4: Exponential backoff retry, no fallback heuristics
   *
   * @param actions - Array of 2-3 user actions (navigation, form, copy-paste)
   * @param retryCount - Current retry attempt (0-3)
   * @returns LLM analysis result with pattern decision + metadata
   */
  async analyzeActionSequence(
    actions: Array<SessionAction>,
    retryCount: number = 0,
  ): Promise<{ success: boolean; result?: LLMAnalysisResult; error?: string }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // Exponential backoff: 2s, 4s, 8s

    try {
      // Build rich context prompt with page titles, element text, tab switches
      const prompt = this.buildLLMPrompt(actions);

      // Call LLM with timeout enforcement (30 seconds)
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

      return { success: true, result };
    } catch (error) {
      // Story 1.19 - AC 4: Log error with full context
      log.error("[LLMPatternAnalyzer] LLM analysis failed", {
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        actionCount: actions.length,
        actionTypes: actions.map((a) => a.type),
        error: error instanceof Error ? error.message : String(error),
      });

      // Story 1.19 - AC 4: Retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount];
        log.info(
          `[LLMPatternAnalyzer] Retrying in ${delay}ms (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`,
        );

        await this.delay(delay);
        return this.analyzeActionSequence(actions, retryCount + 1);
      }

      // Story 1.19 - AC 2, 4: All retries exhausted - return failure (NO fallback heuristics)
      log.error("[LLMPatternAnalyzer] LLM analysis failed after retries", {
        attempts: MAX_RETRIES + 1,
      });

      return {
        success: false,
        error:
          "Pattern analysis temporarily unavailable. Will retry automatically.",
      };
    }
  }

  /**
   * Delay helper for exponential backoff retry
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build LLM prompt with full context
   * Story 1.15 - AC 1: Include page titles, element text, tab switches, timestamps
   */
  private buildLLMPrompt(actions: Array<SessionAction>): string {
    const actionDescriptions = actions
      .map((action, i) => {
        let desc = `${i + 1}. ${action.type.toUpperCase()}\n`;

        // Tab switch specific formatting (Story 1.18 - AC 4)
        if (action.type === "tab_switch") {
          desc += `   - Switched from: "${action.fromTitle}" (${action.fromUrl})\n`;
          desc += `   - Switched to: "${action.toTitle}" (${action.toUrl})\n`;
          desc += `   - From tab ID: ${action.fromTabId}\n`;
          desc += `   - To tab ID: ${action.toTabId}\n`;
        } else {
          desc += `   - Page title: "${action.pageTitle || "Unknown"}"\n`;
          desc += `   - URL: ${action.url}\n`;
        }

        if (action.type === "navigation") {
          try {
            desc += `   - Domain: ${new URL(action.url || "").hostname}\n`;
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

        if (action.type !== "tab_switch") {
          desc += `   - Tab: ${action.tabId}\n`;
        }
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
      {
        "action": string,
        "target": string,
        "selector": string | null,
        "elementContext": string | null,
        "actionDetail": string,
        "url": string | null,
        "tabId": string,
        "tabTitle": string,
        "tabUrl": string
      }
    ]
  },
  "rejectionReason": string | null
}

WORKFLOW STEP FIELD DETAILS:
- action: Type of action (e.g., "click", "copy", "paste", "navigate", "type")
- target: What element to interact with (e.g., "comment link", "search bar", "article title")
- selector: CSS selector or element description (e.g., "a.storylink", "input[name='q']", "first link in comments section")
- elementContext: Where on the page (e.g., "in comments section", "at top of page", "first result", "third item in list")
- actionDetail: Specific action to perform (e.g., "copy text content", "click and wait for page load", "paste and press Enter")
- url: Expected URL after navigation (if applicable, use patterns like "https://news.ycombinator.com/item?id=*")
- tabId/tabTitle/tabUrl: Tab metadata for cross-tab workflows

IMPORTANT - MAXIMIZE DETAIL FOR AUTOMATION:
- Provide as much context as possible for each step to enable reliable automation
- Include CSS selectors when you can infer them from element descriptions (e.g., "input[name='q']" for Google search)
- Specify element position/context (e.g., "first comment link", "third item in results list")
- Detail the exact action (e.g., "copy text content of link", "paste and press Enter key")
- Include expected URLs after navigation (use wildcards like "*/item?id=*" for dynamic parts)
- For clicks: specify if it opens new tab, navigates current tab, or triggers action
- For text input: specify if you need to clear existing text, press Enter, click submit button

IMPORTANT FOR CROSS-TAB WORKFLOWS:
- Include tab metadata (tabId, tabTitle, tabUrl) for each action step
- DO NOT create explicit "tab_switch" action steps - tab switches are inferred from tabId changes
- Be SPECIFIC about websites, domains, and UI elements (e.g., "Hacker News", "Google", "comment link")
- Only generalize the actual DATA values (text content, product names, etc.)
  Example: "click comment link on Hacker News" NOT "click link on news feed"
  Example: "copy article title from Hacker News" NOT "copy headline from news site"
  Example: "paste into Google search" NOT "paste into search engine"
- Keep site names and UI element descriptions specific and recognizable
- Focus on capturing the exact workflow with real site names, not generic categories`;
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
}
