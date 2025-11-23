import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import log from "electron-log";
import type Database from "better-sqlite3";
import type {
  NavigationPattern,
  FormPattern,
  CopyPastePattern,
} from "./PatternManager";

/**
 * Pattern data structure from database
 */
interface PatternData {
  type: "navigation" | "form" | "copy-paste";
  pattern_data: NavigationPattern | FormPattern | CopyPastePattern;
}

/**
 * IntentSummarizer - Singleton service for generating AI-powered intent summaries
 * Implements Story 1.12: AI Pattern Intent Summarization
 * Updated Story 1.19: Remove Template Fallbacks (LLM-only, no templates)
 *
 * Features:
 * - Single LLM API call per pattern (when confidence >70%)
 * - Enhanced text context (page titles, element text, form labels)
 * - 1-hour caching to minimize API costs
 * - Exponential backoff retry on LLM failure (3 attempts: 2s, 4s, 8s delays)
 * - NO fallback templates - pattern analysis fails if LLM unavailable
 * - Cost optimization: GPT-4o-mini or Claude Haiku (<$0.01 per pattern)
 */
// Default models per provider (matching LLMClient.ts pattern)
const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  gemini: "gemini-1.5-flash",
};

export class IntentSummarizer {
  private static instance: IntentSummarizer | null = null;
  private db: Database.Database;
  private provider: "openai" | "anthropic" | "gemini";
  private modelName: string;

  private constructor(db: Database.Database) {
    this.db = db;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();

    log.info(
      `[IntentSummarizer] Initialized with provider: ${this.provider}, model: ${this.modelName}`,
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
   * Get model name from environment or use defaults (matches LLMClient.ts pattern)
   */
  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  /**
   * Get singleton instance
   */
  public static getInstance(db: Database.Database): IntentSummarizer {
    if (!IntentSummarizer.instance) {
      IntentSummarizer.instance = new IntentSummarizer(db);
    }
    return IntentSummarizer.instance;
  }

  /**
   * Summarize pattern intent using LLM with caching and retry logic
   * Story 1.12 - AC 1: Single LLM call per pattern, cached for 1 hour
   * Story 1.19 - AC 1, 4: Exponential backoff retry, no template fallbacks
   * Generates both short (notification) and detailed (chat) summaries
   */
  public async summarizePattern(
    patternId: string,
    retryCount: number = 0,
  ): Promise<{
    success: boolean;
    short?: string;
    detailed?: string;
    error?: string;
  }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // Exponential backoff: 2s, 4s, 8s

    try {
      // Check cache first (Story 1.12 - AC 3)
      const cached = this.getCachedSummary(patternId);
      if (cached) {
        log.info(`[IntentSummarizer] Cache HIT for pattern ${patternId}`);
        return {
          success: true,
          short: cached.short,
          detailed: cached.detailed,
        };
      }

      log.info(`[IntentSummarizer] Cache MISS for pattern ${patternId}`);

      // Get pattern data
      const patternData = this.getPatternData(patternId);
      if (!patternData) {
        throw new Error(`Pattern ${patternId} not found`);
      }

      // Build prompt with enhanced context (Story 1.12 - AC 1)
      const prompt = this.buildPrompt(patternData);

      // Call LLM (Story 1.12 - AC 1, 6) - single call for both summaries
      const response = await this.callLLM(prompt);

      // Parse dual summaries from response
      const summaries = this.parseDualSummaries(response);

      // Cache both summaries (Story 1.12 - AC 3)
      this.cacheSummary(patternId, summaries.short, summaries.detailed);

      log.info(
        `[IntentSummarizer] Generated summaries for ${patternId}:\n  Short: "${summaries.short}"\n  Detailed: "${summaries.detailed}"`,
      );

      return {
        success: true,
        short: summaries.short,
        detailed: summaries.detailed,
      };
    } catch (error) {
      // Story 1.19 - AC 4: Log error with full context
      log.error("[IntentSummarizer] LLM analysis failed", {
        patternId,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        error: error instanceof Error ? error.message : String(error),
      });

      // Story 1.19 - AC 4: Retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount];
        log.info(
          `[IntentSummarizer] Retrying in ${delay}ms (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`,
        );

        await this.delay(delay);
        return this.summarizePattern(patternId, retryCount + 1);
      }

      // Story 1.19 - AC 1, 4: All retries exhausted - return failure (NO template fallback)
      log.error("[IntentSummarizer] LLM analysis failed after retries", {
        patternId,
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
   * Get cached summaries if valid (within 1 hour)
   * Story 1.12 - AC 3: Cached summaries reused for 1 hour
   */
  private getCachedSummary(
    patternId: string,
  ): { short: string; detailed: string } | null {
    try {
      const stmt = this.db.prepare(`
        SELECT intent_summary, intent_summary_detailed, summary_generated_at
        FROM patterns
        WHERE id = ?
      `);

      const row = stmt.get(patternId) as
        | {
            intent_summary: string | null;
            intent_summary_detailed: string | null;
            summary_generated_at: number | null;
          }
        | undefined;

      if (
        !row ||
        !row.intent_summary ||
        !row.intent_summary_detailed ||
        !row.summary_generated_at
      ) {
        return null;
      }

      // Check if cache is still valid (1 hour = 3600000ms)
      const age = Date.now() - row.summary_generated_at;
      if (age > 3600000) {
        log.info(
          `[IntentSummarizer] Cache expired for pattern ${patternId} (age: ${Math.round(age / 1000)}s)`,
        );
        return null;
      }

      return {
        short: row.intent_summary,
        detailed: row.intent_summary_detailed,
      };
    } catch (error) {
      log.error("[IntentSummarizer] Cache lookup error:", error);
      return null;
    }
  }

  /**
   * Get pattern data from database
   */
  private getPatternData(patternId: string): PatternData | null {
    try {
      const stmt = this.db.prepare(`
        SELECT type, pattern_data
        FROM patterns
        WHERE id = ?
      `);

      const row = stmt.get(patternId) as
        | { type: string; pattern_data: string }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        type: row.type as "navigation" | "form",
        pattern_data: JSON.parse(row.pattern_data),
      };
    } catch (error) {
      log.error("[IntentSummarizer] Pattern data fetch error:", error);
      return null;
    }
  }

  /**
   * Build LLM prompt with enhanced context
   * Story 1.12 - AC 1: Include page titles, element text, form labels, action descriptions
   */
  private buildPrompt(patternData: PatternData): string {
    if (
      patternData.type === "navigation" &&
      "sequence" in patternData.pattern_data
    ) {
      const navPattern = patternData.pattern_data as NavigationPattern;

      // Enhanced: Include page titles and URLs
      const steps = navPattern.sequence
        .slice(0, 5) // Limit to first 5 steps to reduce tokens
        .map((step) => {
          const pageTitle = step.pageTitle || new URL(step.url).hostname;
          return `"${pageTitle}"`;
        });

      const sequence =
        navPattern.sequence.length > 5
          ? `${steps.join(" → ")} (${navPattern.sequence.length} total steps)`
          : steps.join(" → ");

      return `A user repeatedly navigates: ${sequence}.

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous (e.g., "Checking...", "Researching...")
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Describe what they're doing and why.

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description starting with a verb like "repeatedly navigating..." or "browsing..."]`;
    } else if (
      patternData.type === "form" &&
      "fields" in patternData.pattern_data
    ) {
      const formPattern = patternData.pattern_data as FormPattern;

      // Filter out hidden/technical fields for cleaner context
      // Keep submit/button types as they now have meaningful labels
      const meaningfulFields = formPattern.fields.filter(
        (f) =>
          f.type === "submit" ||
          f.type === "button" ||
          (f.type !== "hidden" &&
            !f.name.match(/^(csrf|token|ei|iflsig|sca_|ved|gs_)/i)),
      );

      // Build field descriptions with sanitized values when available (Story 1.12 - Code Review fix)
      const fieldDescriptions = meaningfulFields
        .map((f) => {
          const displayName = f.label || this.humanizeFieldName(f.name);

          // Include sanitized value if available for better AI context
          if (f.sanitizedValue) {
            return `${displayName} = "${f.sanitizedValue}"`;
          }

          return displayName;
        })
        .join(", ");

      if (meaningfulFields.length === 0) {
        // If only hidden fields, describe generically
        return `A user repeatedly submits a form on ${formPattern.domain}.

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous (e.g., "Submitting...", "Searching...")
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Describe what they're doing, why, and any patterns.

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description starting with a verb like "repeatedly submitting..." or "using..."]`;
      }

      return `A user repeatedly fills a form on ${formPattern.domain} with: ${fieldDescriptions}.

Generate TWO descriptions (NO greetings like "Hey" - just the activity):

1. SHORT (20-30 words): Start with -ing verb (e.g., "Searching for remote jobs in Stockholm on Indeed")

2. DETAILED (40-50 words): Start with -ing verb, describe:
   - WHAT they're doing (be specific: include search terms, filters, locations)
   - WHY automation helps ("so you can run this search with one click instead of filling out the form each time")
   - Use natural, conversational language (use "you", "your")

Format:
SHORT: [description starting with -ing verb]
DETAILED: [description starting with -ing verb, includes what they're doing and why automation helps]

Example:
SHORT: Searching for remote software engineer jobs in Stockholm on Indeed
DETAILED: searching for "remote software engineer" positions on Indeed, filtering by Stockholm location. Automation will save you from typing the same search and location every time - just click and the form fills instantly`;
    } else if (
      patternData.type === "copy-paste" &&
      "pairs" in patternData.pattern_data
    ) {
      // Story 1.7b - AC 2: Copy/Paste pattern prompt (Bug fix: Include copied text + element context)
      const copyPastePattern = patternData.pattern_data as CopyPastePattern;
      const firstPair = copyPastePattern.pairs[0];

      if (!firstPair) {
        return `A user performs repeated copy/paste operations.

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous (e.g., "Copying...", "Transferring...")
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Include context and purpose.

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description starting with a verb like "repeatedly copying..." or "transferring..."]`;
      }

      // Extract source and destination page titles
      const sourcePageTitle =
        firstPair.sourcePageTitle || new URL(firstPair.sourceUrl).hostname;
      const destinationPageTitle =
        firstPair.destinationPageTitle ||
        new URL(firstPair.destinationUrl).hostname;

      // Get copied text (or indicate if sensitive/hashed)
      const copiedText = firstPair.copiedText || "[sensitive content]";

      // Extract element info (helps identify search boxes, forms, input fields)
      const sourceElement = firstPair.sourceElement || "unknown element";
      const destinationElement =
        firstPair.destinationElement || "unknown element";

      // Detect same-site copy/paste (often search/form workflows)
      const sourceHost = new URL(firstPair.sourceUrl).hostname;
      const destHost = new URL(firstPair.destinationUrl).hostname;
      const isSameSite = sourceHost === destHost;

      // Build context-aware prompt
      if (isSameSite) {
        // Same-site pattern: likely search, form filling, or data entry within same tool
        return `A user repeatedly copies "${copiedText}" and pastes it on the SAME website ("${sourcePageTitle}").

Context:
- Source element: ${sourceElement}
- Destination element: ${destinationElement}
- Pattern occurred: ${copyPastePattern.pairs.length} times

This is likely a SEARCH or FORM WORKFLOW on the same site (not data transfer between sites).

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous (e.g., "Searching for...", "Entering...")
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Describe what they're searching for or what workflow they're repeating.

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description starting with a verb like "repeatedly searching for..." or "entering..."]

Examples for same-site workflows:
SHORT: Searching for "meta quest 3" on Blocket by copying and pasting the search term
DETAILED: repeatedly searching for "meta quest 3" on Blocket by copying the search query and pasting it into the search box, likely checking availability across different sessions or tabs`;
      } else {
        // Cross-site pattern: data transfer between platforms
        return `A user repeatedly copies "${copiedText}" from "${sourcePageTitle}" and pastes it into "${destinationPageTitle}".

Context:
- Source: ${firstPair.sourceUrl} (${sourceElement})
- Destination: ${firstPair.destinationUrl} (${destinationElement})
- Pattern occurred: ${copyPastePattern.pairs.length} times

This is CROSS-SITE data transfer (not same-site search/form workflow).

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous (e.g., "Copying contact info...", "Transferring data...")
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Describe the data transfer workflow - what data is being moved and why.

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description starting with a verb like "repeatedly copying..." or "transferring..."]

Examples for cross-site workflows:
SHORT: Copying contact info from LinkedIn to CRM
DETAILED: repeatedly copying contact information from LinkedIn profiles to a customer relationship management system for sales lead tracking`;
      }
    }

    return `A user performs a repeated action.

Generate TWO descriptions in SECOND PERSON (addressing the user as "you"):
1. SHORT (for notifications, 20-30 words): Start with a verb in present continuous
2. DETAILED (for chat, 40-50 words): Write in second person (use "you're", "you", "your"). Include context and purpose

Format your response as:
SHORT: [your 20-30 word description]
DETAILED: [your 40-50 word description]`;
  }

  /**
   * Parse dual summaries from LLM response
   */
  private parseDualSummaries(response: string): {
    short: string;
    detailed: string;
  } {
    try {
      // Extract SHORT and DETAILED using regex
      const shortMatch = response.match(/SHORT:\s*(.+?)(?=\n|DETAILED:|$)/is);
      const detailedMatch = response.match(/DETAILED:\s*(.+?)$/is);

      const short = shortMatch
        ? shortMatch[1].trim()
        : response.split("\n")[0].trim();
      const detailed = detailedMatch
        ? detailedMatch[1].trim()
        : response.trim();

      return { short, detailed };
    } catch (error) {
      log.warn("[IntentSummarizer] Failed to parse dual summaries:", error);
      // Fallback: use entire response for both
      return { short: response.trim(), detailed: response.trim() };
    }
  }

  /**
   * Convert camelCase or snake_case field names to human-readable format
   */
  private humanizeFieldName(name: string): string {
    return (
      name
        // Handle common abbreviations
        .replace(/^q$/i, "search query")
        .replace(/^l$/i, "location")
        .replace(/^btn/i, "button")
        // Convert camelCase to spaces
        .replace(/([A-Z])/g, " $1")
        // Convert snake_case to spaces
        .replace(/_/g, " ")
        // Remove special chars
        .replace(/[^a-zA-Z0-9 ]/g, "")
        // Trim and lowercase
        .trim()
        .toLowerCase()
    );
  }

  /**
   * Call LLM with cost optimization settings
   * Story 1.12 - AC 1, 6: Temperature 0.3, concise prompt for cost control
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

    // Initialize model (models are initialized without apiKey parameter in constructor)
    let model;
    if (this.provider === "anthropic") {
      model = anthropic(this.modelName);
    } else if (this.provider === "gemini") {
      model = google(this.modelName);
    } else {
      model = openai(this.modelName);
    }

    // Call LLM with cost-optimized settings
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0.3, // Low temperature for consistent, focused output
      // Note: maxTokens not available in generateText - control via prompt instead
    });

    log.info(`[IntentSummarizer] LLM response: "${text}"`);

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
   * Cache summaries in database
   * Story 1.12 - AC 3: Store summaries with timestamp for 1-hour invalidation
   */
  private cacheSummary(
    patternId: string,
    shortSummary: string,
    detailedSummary: string,
  ): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE patterns
        SET intent_summary = ?,
            intent_summary_detailed = ?,
            summary_generated_at = ?
        WHERE id = ?
      `);

      stmt.run(shortSummary, detailedSummary, Date.now(), patternId);

      log.info(`[IntentSummarizer] Cached summaries for pattern ${patternId}`);
    } catch (error) {
      log.error("[IntentSummarizer] Cache save error:", error);
    }
  }
}
