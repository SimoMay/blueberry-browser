import { generateObject } from "ai";
import log from "electron-log";
import * as dotenv from "dotenv";
import { join } from "path";
import {
  LLMAnalysisResultSchema,
  type LLMAnalysisResult,
} from "./schemas/patternSchemas";
import { LLMProviderConfig } from "./LLMProviderConfig";

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
  private config: LLMProviderConfig;
  private requestTimeout = 30000; // 30 seconds max (Gemini API can be slow, cross-tab analysis needs more time)

  constructor() {
    // AC-4: Use centralized LLMProviderConfig instead of duplicated code
    this.config = new LLMProviderConfig(false); // Use standard models, not vision models
  }

  /**
   * Analyze action sequence to determine if it's a pattern
   * Story 1.15 - AC 1, 2, 3
   * Story 1.19 - AC 2, 4: Exponential backoff retry, no fallback heuristics
   * AC-3: Retry logic now handled by SDK (maxRetries: 3 in generateObject())
   *
   * @param actions - Array of 2-3 user actions (navigation, form, copy-paste)
   * @returns LLM analysis result with pattern decision + metadata
   */
  async analyzeActionSequence(
    actions: Array<SessionAction>,
  ): Promise<{ success: boolean; result?: LLMAnalysisResult; error?: string }> {
    try {
      // Build rich context prompt with page titles, element text, tab switches
      const prompt = this.buildLLMPrompt(actions);

      // Call LLM with timeout enforcement (30 seconds)
      // AC-2: Use generateObject() for structured output (no manual JSON parsing needed)
      // AC-3: SDK handles retries automatically with maxRetries: 3
      const result = await Promise.race([
        this.callLLM(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("LLM timeout")),
            this.requestTimeout,
          ),
        ),
      ]);

      log.info("[LLMPatternAnalyzer] Pattern analysis complete", {
        isPattern: result.isPattern,
        confidence: result.confidence,
        intent: result.intentSummary,
      });

      return { success: true, result };
    } catch (error) {
      // AC-3: Error handling updated for SDK retry failures
      log.error("[LLMPatternAnalyzer] LLM analysis failed after SDK retries", {
        actionCount: actions.length,
        actionTypes: actions.map((a) => a.type),
        error: error instanceof Error ? error.message : String(error),
      });

      // Story 1.19 - AC 2, 4: All SDK retries exhausted - return failure (NO fallback heuristics)
      return {
        success: false,
        error:
          "Pattern analysis temporarily unavailable. Will retry automatically.",
      };
    }
  }

  // AC-3: Removed manual retry logic - SDK now handles retries with exponential backoff

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
   * Call LLM with cost-optimized settings using generateObject() for structured output
   * Story 1.15 - AC 1: Fast models (GPT-4o-mini, Claude Haiku), <2 second response
   * AC-2: Use generateObject() with Zod schema instead of manual JSON parsing
   * AC-4: Use LLMProviderConfig for model initialization
   */
  private async callLLM(prompt: string): Promise<LLMAnalysisResult> {
    // AC-4: Use centralized config to initialize model
    const model = this.config.initializeModel();
    if (!model) {
      throw new Error(
        `${this.config.getProvider().toUpperCase()}_API_KEY not found in environment`,
      );
    }

    // AC-2: Use generateObject() with Zod schema for structured output
    const { object } = await generateObject({
      model,
      prompt,
      schema: LLMAnalysisResultSchema,
      /**
       * Temperature: 0.3 (Deterministic - Pattern Detection)
       * Rationale: Low temperature ensures consistent pattern detection decisions.
       * We need the AI to reliably identify workflows vs. random actions with
       * minimal variance between runs. Higher temperatures could cause inconsistent
       * pattern detection (same actions detected as pattern one time, not another).
       */
      temperature: 0.3,
      maxRetries: 3, // AC-3: SDK handles retries automatically
    });

    log.info("[LLMPatternAnalyzer] LLM response (structured)", {
      isPattern: object.isPattern,
      confidence: object.confidence,
      intent: object.intentSummary?.substring(0, 100),
    });

    return object;
  }

  // AC-2: Removed parseLLMResponse() method - generateObject() handles JSON parsing and validation automatically
  // AC-4: Removed getProvider(), getModelName(), getApiKey() methods - now handled by LLMProviderConfig
}
