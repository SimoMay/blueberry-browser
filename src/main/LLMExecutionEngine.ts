import { generateText, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import log from "electron-log";
import type { Tab } from "./Tab";
import {
  LLMExecutionStepSchema,
  type LLMExecutionStep,
} from "./schemas/patternSchemas";
import * as dotenv from "dotenv";
import { join } from "path";

// Load environment variables
dotenv.config({ path: join(__dirname, "../../.env") });

/**
 * Page state captured before each LLM decision
 */
interface PageState {
  title: string;
  url: string;
  interactiveElements: Array<{
    tag: string;
    selector: string;
    label: string;
    text: string;
  }>;
}

/**
 * Execution history entry
 */
interface ExecutionHistoryEntry {
  action: string;
  description: string;
  timestamp: number;
  extractedContent?: string; // Content extracted from page (for copy/paste workflows)
}

/**
 * Automation data loaded from database
 */
interface AutomationData {
  id: string;
  name: string;
  description?: string;
  intentSummary?: string;
  workflow: unknown; // AI-decided format (flexible JSON structure)
  patternData: string;
}

/**
 * LLMExecutionEngine - LLM-guided automation execution
 * Story 1.16: Replaces deterministic AutomationExecutor with page-by-page AI decisions
 *
 * Core Principle: For each step, ask LLM "What should I do next on this page?"
 * - Sends: workflow summary, screenshot, interactive elements, execution history
 * - Receives: nextAction (click/type/navigate/wait/complete), target, value, reasoning
 * - Executes action → waits for page settle → captures new state → repeats
 *
 * AC Coverage:
 * - AC 1: LLM decision with vision in <5 seconds
 * - AC 2: Execute action + wait for page settle + progress updates
 * - AC 3: Completion detection and statistics logging
 * - AC 4: Error handling with retry logic
 * - AC 5: User cancellation support
 * - AC 6: Layout adaptation (LLM adapts to new layouts automatically)
 * - AC 7: Form submission with proper event triggering and sanitization
 */
export class LLMExecutionEngine {
  private model: LanguageModel | null = null;
  private executionHistory: ExecutionHistoryEntry[] = [];
  private isCancelled = false;
  private readonly requestTimeout = 30000; // 30 seconds max per LLM call (vision models can be slow)
  private readonly maxSteps = 50; // Safety limit to prevent infinite loops
  private lastError: string | null = null; // Track last action error for AI recovery
  private consecutiveErrors = 0; // Track error streak to prevent infinite retry loops
  private readonly maxConsecutiveErrors = 3; // Give up after 3 failed attempts
  private onProgress?: (
    step: number,
    total: number,
    description: string,
    screenshotBase64?: string,
  ) => void;

  constructor() {
    this.model = this.initializeModel();
  }

  /**
   * Initialize vision-capable LLM model (GPT-4o, Claude Sonnet, or Gemini Pro)
   * AC 1: Uses vision-capable model for screenshot analysis
   */
  private initializeModel(): LanguageModel | null {
    try {
      const provider = this.getProvider();
      const modelName = this.getModelName(provider);
      const apiKey = this.getApiKey(provider);

      if (!apiKey) {
        log.error(
          `[LLMExecutionEngine] API key not found for provider: ${provider}`,
        );
        return null;
      }

      // Set environment variable for Gemini (required by @ai-sdk/google)
      if (provider === "gemini") {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
      }

      switch (provider) {
        case "anthropic":
          return anthropic(modelName);
        case "openai":
          return openai(modelName);
        case "gemini":
          return google(modelName);
        default:
          return null;
      }
    } catch (error) {
      log.error("[LLMExecutionEngine] Model initialization failed:", error);
      return null;
    }
  }

  private getProvider(): "openai" | "anthropic" | "gemini" {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "gemini") return "gemini";
    return "openai"; // Default to OpenAI
  }

  private getModelName(provider: "openai" | "anthropic" | "gemini"): string {
    const envModel = process.env.LLM_MODEL;
    if (envModel) return envModel;

    // Default vision-capable models (AC 1)
    const defaults = {
      openai: "gpt-4o", // Vision-capable
      anthropic: "claude-3-5-sonnet-20241022", // Vision-capable
      gemini: "gemini-1.5-pro", // Vision-capable (using Pro for better accuracy)
    };
    return defaults[provider];
  }

  private getApiKey(
    provider: "openai" | "anthropic" | "gemini",
  ): string | undefined {
    switch (provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      case "gemini":
        return process.env.GEMINI_API_KEY;
      default:
        return undefined;
    }
  }

  /**
   * Execute automation with LLM-guided decisions
   * AC 1, 2, 3: Main execution loop
   *
   * @param automationData - Automation loaded from database with workflow
   * @param activeTab - Tab to execute automation in
   * @param onProgress - Progress callback (step, total, description, screenshot)
   */
  public async executeAutomation(
    automationData: AutomationData,
    activeTab: Tab,
    onProgress?: (
      step: number,
      total: number,
      description: string,
      screenshotBase64?: string,
    ) => void,
  ): Promise<{
    success: boolean;
    stepsExecuted: number;
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();
    this.onProgress = onProgress;
    this.executionHistory = [];
    this.isCancelled = false;
    this.lastError = null; // Reset error state
    this.consecutiveErrors = 0;

    try {
      if (!this.model) {
        throw new Error(
          "LLM model not initialized. Please configure API key in .env file.",
        );
      }

      log.info("[LLMExecutionEngine] Starting execution", {
        automationId: automationData.id,
        name: automationData.name,
      });

      // Parse workflow data (AI-decided format from Story 1.15)
      const workflow = JSON.parse(automationData.patternData);

      // Note: Start URL navigation now handled by PatternManager.executeAutomation()
      // which creates a new tab with the start URL already loaded
      // Wait for page to settle before starting automation
      await this.waitForPageSettle(activeTab);

      // Execution loop (AC 1, 2)
      let stepCount = 0;

      while (stepCount < this.maxSteps && !this.isCancelled) {
        stepCount++;

        // Detect infinite loops (AC 3: auto-complete if stuck)
        if (stepCount > 10) {
          const recentActions = this.executionHistory
            .slice(-6)
            .map((h) => h.action)
            .join(",");
          // Check if last 6 actions form a repeating pattern (e.g., "navigate,type,click,navigate,type,click")
          if (this.isRepeatingPattern(recentActions)) {
            log.warn("[LLMExecutionEngine] Loop detected, auto-completing", {
              pattern: recentActions,
            });
            this.emitProgress(
              "complete",
              stepCount,
              "Auto-completed: Detected repeating action pattern (possible infinite loop)",
            );
            const duration = Date.now() - startTime;
            return {
              success: true,
              stepsExecuted: stepCount,
              duration,
            };
          }
        }

        // Capture page state (AC 1)
        const pageState = await this.capturePageState(activeTab);

        // Get LLM decision with vision (AC 1)
        const step = await this.getLLMDecision(
          automationData,
          workflow,
          pageState,
          activeTab,
        );

        // Check if workflow is complete (AC 3)
        if (step.isComplete || step.nextAction === "complete") {
          log.info("[LLMExecutionEngine] Workflow complete", {
            totalSteps: stepCount,
            duration: Date.now() - startTime,
          });

          this.emitProgress("complete", stepCount, step.reasoning);

          const duration = Date.now() - startTime;
          return {
            success: true,
            stepsExecuted: stepCount,
            duration,
          };
        }

        // Execute action (AC 2) - with error recovery
        try {
          await this.executeAction(step, activeTab);

          // Action succeeded - clear error state
          this.lastError = null;
          this.consecutiveErrors = 0;

          // Wait for page to settle (AC 2)
          await this.waitForPageSettle(activeTab);

          // Extract content if workflow indicates this page has content to copy
          const extractedContent = await this.extractContentIfNeeded(
            workflow,
            pageState,
            activeTab,
          );

          // Record in history
          this.executionHistory.push({
            action: step.nextAction,
            description: `${step.nextAction}: ${step.target}`,
            timestamp: Date.now(),
            extractedContent, // Include extracted content for later use
          });
        } catch (actionError) {
          // Action failed - give AI context to try again
          this.consecutiveErrors++;

          // Check if we've hit the retry limit
          if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            log.error(
              `[LLMExecutionEngine] Max consecutive errors (${this.maxConsecutiveErrors}) reached`,
              actionError,
            );
            throw new Error(
              `Action failed after ${this.maxConsecutiveErrors} attempts: ${actionError instanceof Error ? actionError.message : "Unknown error"}`,
            );
          }

          // Store error for next LLM prompt
          this.lastError =
            actionError instanceof Error
              ? actionError.message
              : "Unknown error";

          log.warn(
            `[LLMExecutionEngine] Action failed (attempt ${this.consecutiveErrors}/${this.maxConsecutiveErrors}), AI will retry`,
            {
              error: this.lastError,
              action: step.nextAction,
              target: step.target,
            },
          );

          // Don't record failed action in history
          // Continue loop - AI will see the error and try a different approach
          continue;
        }

        // Capture screenshot thumbnail for progress display (AC 5)
        let screenshotBase64: string | undefined;
        try {
          const screenshot = await activeTab.screenshot();
          // Resize to small thumbnail (320px width) for efficient transmission
          const thumbnail = screenshot.resize({ width: 320 });
          screenshotBase64 = thumbnail.toDataURL();
        } catch (error) {
          log.warn(
            "[LLMExecutionEngine] Failed to capture progress screenshot:",
            error,
          );
          // Continue without screenshot - not critical for execution
        }

        // Emit progress (AC 2, AC 5)
        this.emitProgress(
          step.nextAction,
          stepCount,
          step.reasoning,
          step.estimatedStepsRemaining || undefined,
          screenshotBase64,
        );
      }

      // Max steps reached or cancelled
      const duration = Date.now() - startTime;

      if (this.isCancelled) {
        log.info("[LLMExecutionEngine] Execution cancelled by user", {
          stepsExecuted: stepCount,
          duration,
        });
        return {
          success: false,
          stepsExecuted: stepCount,
          duration,
          error: `Cancelled at step ${stepCount}`,
        };
      } else {
        log.warn("[LLMExecutionEngine] Max steps reached", {
          maxSteps: this.maxSteps,
          duration,
        });
        return {
          success: false,
          stepsExecuted: stepCount,
          duration,
          error: `Maximum steps (${this.maxSteps}) reached without completion`,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error("[LLMExecutionEngine] Execution failed", error);

      return {
        success: false,
        stepsExecuted: this.executionHistory.length,
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get LLM decision for next action (with vision)
   * AC 1: LLM receives workflow, screenshot, page context, execution history
   * AC 4: Error handling with retry logic
   */
  private async getLLMDecision(
    automationData: AutomationData,
    workflow: unknown,
    pageState: PageState,
    activeTab: Tab,
  ): Promise<LLMExecutionStep> {
    try {
      // Build vision-enabled prompt (AC 1)
      const prompt = this.buildLLMPrompt(automationData, workflow, pageState);

      // Take screenshot (AC 1)
      const screenshot = await activeTab.screenshot();
      // Resize to 640px width for faster processing and reduced tokens, use PNG for compatibility
      const resized = screenshot.resize({ width: 640 });
      const screenshotBase64 = resized.toDataURL();

      // Build messages with vision
      const messages: CoreMessage[] = [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: screenshotBase64,
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ];

      // Call LLM with timeout (AC 1: <5 seconds)
      const response = await Promise.race([
        this.callLLM(messages),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("LLM decision timeout")),
            this.requestTimeout,
          ),
        ),
      ]);

      // Parse and validate response (AC 1)
      const step = this.parseLLMStep(response);

      log.info("[LLMExecutionEngine] LLM decision", {
        action: step.nextAction,
        target: step.target,
        reasoning: step.reasoning,
        isComplete: step.isComplete,
      });

      return step;
    } catch (error) {
      log.error("[LLMExecutionEngine] LLM decision failed", error);

      // Retry once with exponential backoff (AC 4)
      log.info("[LLMExecutionEngine] Retrying LLM call after 2s...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const prompt = this.buildLLMPrompt(automationData, workflow, pageState);
        const screenshot = await activeTab.screenshot();
        // Resize to 640px width for faster processing and reduced tokens, use PNG for compatibility
        const resized = screenshot.resize({ width: 640 });
        const screenshotBase64 = resized.toDataURL();

        const messages: CoreMessage[] = [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: screenshotBase64,
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ];

        const response = await this.callLLM(messages);
        const step = this.parseLLMStep(response);

        log.info("[LLMExecutionEngine] Retry successful", {
          action: step.nextAction,
        });

        return step;
      } catch (retryError) {
        log.error("[LLMExecutionEngine] Retry failed", retryError);
        // AC 4: User-friendly error message
        throw new Error(
          "Automation paused - AI guidance unavailable. Please retry.",
        );
      }
    }
  }

  /**
   * Call LLM API with vision support
   */
  private async callLLM(messages: CoreMessage[]): Promise<string> {
    if (!this.model) {
      throw new Error("LLM model not initialized");
    }

    const result = await generateText({
      model: this.model,
      messages,
      temperature: 0.3, // Low temperature for consistent structured output
      maxRetries: 0, // We handle retries manually
      // Note: maxTokens not available in current AI SDK version
      // Response length naturally limited by JSON format constraint
    });

    return result.text;
  }

  /**
   * Build LLM prompt with workflow context and page state
   * AC 1: Prompt includes workflow summary, steps, execution history, page state
   */
  private buildLLMPrompt(
    automationData: AutomationData,
    workflow: unknown,
    pageState: PageState,
  ): string {
    // Only send last 5 steps to reduce context size and improve speed
    const recentHistory = this.executionHistory.slice(-5);
    const historyText =
      recentHistory.length > 0
        ? recentHistory
            .map((step, i) => {
              const stepNum =
                this.executionHistory.length - recentHistory.length + i + 1;
              const base = `${stepNum}. ${step.action}: ${step.description}`;
              return step.extractedContent
                ? `${base}\n   → Extracted: "${step.extractedContent}"`
                : base;
            })
            .join("\n")
        : "None - this is the first step";

    // Collect all extracted content from history for easy reference
    const extractedContents = this.executionHistory
      .filter((step) => step.extractedContent)
      .map((step, i) => `${i + 1}. "${step.extractedContent}"`)
      .join("\n");

    // Format interactive elements for LLM (show selector first, then label)
    // This helps LLM understand which CSS selector to use for each element
    // Limit to 12 most relevant elements to reduce noise and save tokens
    const elementsText = pageState.interactiveElements
      .map((el) => {
        const label = el.label || el.text;
        return `  - Selector: ${el.selector} → Text: "${label}"`;
      })
      .join("\n");

    return `You are guiding a browser automation by understanding USER INTENT and adapting to page changes.

WORKFLOW INTENT:
${automationData.intentSummary || automationData.description || "No summary available"}

WORKFLOW REFERENCE (illustrative pattern, NOT literal steps to replay):
${JSON.stringify(workflow, null, 2)}

EXECUTION HISTORY (what we've done so far):
${historyText}

${extractedContents ? `EXTRACTED CONTENT (from previous pages):\n${extractedContents}\n` : ""}${this.lastError ? `❌ PREVIOUS ACTION FAILED:\nError: ${this.lastError}\nAttempt ${this.consecutiveErrors}/${this.maxConsecutiveErrors} - Try a DIFFERENT approach this time!\n\n` : ""}
CURRENT PAGE STATE:
- Title: "${pageState.title}"
- URL: ${pageState.url}
- Interactive elements available now:
${elementsText}

SCREENSHOT: [see image above for current page appearance]

CRITICAL INSTRUCTIONS:
You must understand the INTENT of the workflow, not replay exact actions.
- Workflow shows COPY/PASTE? → Understand it means "extract topic, then search for it"
- Workflow has specific selectors like "#APjFqb"? → IGNORE them, find the search box yourself
- Workflow has specific text? → Understand it's an EXAMPLE, use current page content
- Page layout changed? → Adapt! Find equivalent elements on the current page
- When typing into fields, USE THE EXTRACTED CONTENT from previous pages (see "EXTRACTED CONTENT" section above)
- NEVER use placeholder text like "Product Hunt product" - always use the actual extracted content
- If you need to navigate to a specific website (e.g., producthunt.com, linkedin.com) but can't find the link in the interactive elements list, use the "navigate" action with the full URL directly (e.g., "https://www.producthunt.com/") instead of marking the workflow as complete or giving up

SELECTOR RULES (CRITICAL - READ CAREFULLY):
- Use ONLY standard CSS selectors compatible with document.querySelector()
- FORBIDDEN jQuery/custom pseudo-selectors:
  - :contains("text") ← INVALID! Does not exist in CSS
  - :visible ← INVALID!
  - :has() ← INVALID in most browsers!
  - [text="..."] ← INVALID! "text" is not a valid HTML attribute
- VALID selector examples:
  - #cookieButton ← ID selector
  - button.accept ← Class selector
  - button[type="submit"] ← Attribute selector (type, name, href, aria-label are valid)
  - button[aria-label="Accept cookies"] ← Aria-label attribute
  - a[href*="producthunt"] ← Contains match
  - [data-blueberry-index="17"] ← Indexed selector (used for cookie buttons and elements without IDs)
- To find elements by their displayed text:
  - Look at the "Interactive elements" list above
  - Find the element with matching text
  - Use the EXACT SELECTOR shown (e.g., "[data-blueberry-index='17']" not "button[text='...']")
- Cookie consent buttons are PRIORITIZED at the top of the interactive elements list
- NEVER invent CSS syntax - only use selectors from the interactive elements list!

TASK: Decide the next action based on workflow INTENT and current page state.

RESPOND IN JSON FORMAT (no markdown, pure JSON only):
{
  "nextAction": "click" | "type" | "navigate" | "wait" | "extract" | "press" | "complete",
  "target": "CSS selector or URL (adapt to current page)",
  "value": "text to type OR key to press (e.g., 'Enter')" | null,
  "reasoning": "explain how this advances the workflow INTENT",
  "isComplete": boolean,
  "estimatedStepsRemaining": number | null
}

ACTION TYPES:
- "click": Click button/link to navigate or trigger action
- "type": Enter text into form field
- "navigate": Navigate to a specific URL
- "wait": Wait for page to load/settle
- "extract": Extract content from current page (system auto-extracts headings/titles visible in screenshot)
- "press": Press a keyboard key (value = "Enter" to submit forms, "Escape" to close dialogs, "Tab" to move focus)
- "complete": Workflow goal achieved, stop execution

IMPORTANT FOR EXTRACT ACTION:
- Extract works best on DETAIL/SINGLE-ITEM pages (not list/index pages)
- Strategy: If on a list/index page, click an item link to navigate to its detail page first, THEN extract
- On detail pages, system auto-extracts h1, h2, h3 headings and prominent text content
- Use extract AFTER navigating into specific items, not on list/overview pages
- Example workflow: click item → extract → navigate to destination → paste → repeat

COMPLETION RULES:
1. Mark isComplete=true when the workflow's GOAL is achieved (not just when all steps done)
2. If stuck in a loop (same actions repeating), mark isComplete=true
3. If workflow intent is already satisfied, mark isComplete=true

Return ONLY valid JSON, no markdown code blocks.`;
  }

  /**
   * Parse and validate LLM response
   * AC 1: Validates LLM response structure with Zod
   * Enhanced to extract JSON even if there's text before/after
   */
  private parseLLMStep(response: string): LLMExecutionStep {
    try {
      let cleanedResponse = response.trim();

      // Try to extract JSON from markdown code blocks first
      const codeBlockMatch = cleanedResponse.match(
        /```json?\s*\n?([\s\S]*?)\n?```/i,
      );
      if (codeBlockMatch) {
        cleanedResponse = codeBlockMatch[1].trim();
      } else {
        // Try to find JSON object anywhere in the response
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanedResponse = jsonMatch[0];
        }
      }

      const json = JSON.parse(cleanedResponse);
      const validated = LLMExecutionStepSchema.parse(json);
      return validated;
    } catch (error) {
      log.error("[LLMExecutionEngine] Failed to parse LLM response", error);
      log.error("[LLMExecutionEngine] Raw response:", response);
      throw new Error(
        "Invalid LLM response format. Please check logs for details.",
      );
    }
  }

  /**
   * Execute action based on LLM decision
   * AC 2, 7: Execute click/type/navigate/wait/extract actions
   */
  private async executeAction(step: LLMExecutionStep, tab: Tab): Promise<void> {
    switch (step.nextAction) {
      case "click":
        if (!step.target) {
          throw new Error("Click action requires a target selector");
        }
        await this.executeClick(step.target, tab);
        break;
      case "extract":
        // Extract action doesn't require clicking - content extraction happens automatically
        // via extractContentIfNeeded() which pulls headings and prominent text
        log.info(
          "[LLMExecutionEngine] Extract action - content will be auto-extracted from page",
          {
            target: step.target,
          },
        );
        // No action needed - extractContentIfNeeded() will run after this
        break;
      case "type":
        if (!step.target) {
          throw new Error("Type action requires a target selector");
        }
        await this.executeType(step.target, step.value || "", tab);
        break;
      case "navigate":
        if (!step.target) {
          throw new Error("Navigate action requires a URL");
        }
        await tab.loadURL(step.target);
        break;
      case "wait": {
        const duration = parseInt(step.value || "1000");
        await new Promise((resolve) => setTimeout(resolve, duration));
        break;
      }
      case "press":
        await this.executePress(step.target, step.value || "Enter", tab);
        break;
      case "complete":
        // Do nothing, execution will stop
        break;
    }
  }

  /**
   * Execute press key action
   * Presses a keyboard key (e.g., "Enter" to submit forms)
   */
  private async executePress(
    target: string | null,
    key: string,
    tab: Tab,
  ): Promise<void> {
    try {
      const result = await tab.webContents.executeJavaScript(`
        (function() {
          const key = ${JSON.stringify(key)};
          const selector = ${JSON.stringify(target)};

          try {
            // If target specified, focus element first
            if (selector) {
              const element = document.querySelector(selector);
              if (element) {
                element.focus();
              }
            }

            // Press the key on the focused element (or document if no target)
            const targetElement = selector ? document.querySelector(selector) : document.activeElement || document.body;

            if (!targetElement) {
              return {
                success: false,
                error: 'No target element found'
              };
            }

            // Dispatch keyboard events
            const eventOptions = {
              key: key,
              code: key === 'Enter' ? 'Enter' : key,
              keyCode: key === 'Enter' ? 13 : (key === 'Escape' ? 27 : (key === 'Tab' ? 9 : 0)),
              which: key === 'Enter' ? 13 : (key === 'Escape' ? 27 : (key === 'Tab' ? 9 : 0)),
              bubbles: true,
              cancelable: true
            };

            targetElement.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
            targetElement.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
            targetElement.dispatchEvent(new KeyboardEvent('keyup', eventOptions));

            return { success: true, key, selector };
          } catch (err) {
            return {
              success: false,
              error: err.message,
              key,
              selector
            };
          }
        })()
      `);

      if (!result.success) {
        log.error("[LLMExecutionEngine] Press key failed", result);
        throw new Error(
          `Failed to press ${key}: ${result.error || "Unknown error"}`,
        );
      }

      log.info("[LLMExecutionEngine] Pressed key", {
        key,
        target: target || "active element",
      });
    } catch (error) {
      log.error("[LLMExecutionEngine] Press execution failed", {
        error,
        key,
        target,
      });
      throw error;
    }
  }

  /**
   * Execute click action
   * AC 2, 6: Click element by selector (adapts to layout changes)
   */
  private async executeClick(target: string, tab: Tab): Promise<void> {
    try {
      // JSON.stringify handles all escaping automatically - no need for manual sanitization
      // Add detailed error reporting to help debug selector issues
      const result = await tab.webContents.executeJavaScript(`
        (function() {
          const selector = ${JSON.stringify(target)};
          try {
            const element = document.querySelector(selector);
            if (element) {
              element.click();
              return { success: true, selector };
            } else {
              return {
                success: false,
                error: 'Element not found',
                selector,
                totalButtons: document.querySelectorAll('button').length,
                totalLinks: document.querySelectorAll('a').length
              };
            }
          } catch (err) {
            return {
              success: false,
              error: err.message,
              selector
            };
          }
        })();
      `);

      if (!result.success) {
        log.error(
          "[LLMExecutionEngine] Click failed - element not found",
          result,
        );
        throw new Error(
          `Element not found: ${result.selector}. Page has ${result.totalButtons || 0} buttons, ${result.totalLinks || 0} links.`,
        );
      }

      log.info("[LLMExecutionEngine] Clicked element", { target });
    } catch (error) {
      log.error("[LLMExecutionEngine] Click failed", { target, error });
      throw error;
    }
  }

  /**
   * Execute type action (form input)
   * AC 7: Set field value with proper event triggering and sanitization
   */
  private async executeType(
    target: string,
    value: string,
    tab: Tab,
  ): Promise<void> {
    try {
      // JSON.stringify handles all escaping automatically
      // Still sanitize input value for XSS prevention (remove script tags)
      const sanitizedValue = this.sanitizeInput(value);

      // AC 7: Trigger appropriate events for framework compatibility
      await tab.webContents.executeJavaScript(`
        (function() {
          const element = document.querySelector(${JSON.stringify(target)});
          if (element) {
            element.value = ${JSON.stringify(sanitizedValue)};

            // Trigger events for React/Vue/Angular compatibility
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));

            return true;
          } else {
            throw new Error('Element not found: ' + ${JSON.stringify(target)});
          }
        })();
      `);

      log.info("[LLMExecutionEngine] Typed into field", { target });
    } catch (error) {
      log.error("[LLMExecutionEngine] Type failed", error);
      throw error;
    }
  }

  /**
   * Wait for page to settle after navigation or action
   * AC 2: Wait for network idle and DOM mutations to complete
   */
  private async waitForPageSettle(tab: Tab): Promise<void> {
    const timeout = 10000; // 10 seconds max (AC 2)
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < timeout) {
        // Check if page is still loading
        const isLoading = await tab.webContents.executeJavaScript(`
          document.readyState !== 'complete'
        `);

        if (!isLoading) {
          // Wait a bit more for any pending network requests or DOM mutations
          await new Promise((resolve) => setTimeout(resolve, 500));
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      log.warn("[LLMExecutionEngine] Page settle timeout");
    } catch (error) {
      log.error("[LLMExecutionEngine] Page settle error:", error);
      // Continue anyway - page might still be usable
    }
  }

  /**
   * Capture current page state for LLM context
   * AC 1: Extract page title, URL, and interactive elements
   */
  private async capturePageState(tab: Tab): Promise<PageState> {
    try {
      const title = await tab.webContents.getTitle();
      const url = tab.webContents.getURL();

      // Extract interactive elements (AC 1)
      // Enhanced to give LLM better selector options and text content
      // IMPORTANT: We tag elements with data-blueberry-index for reliable nth-child selection
      const interactiveElements = await tab.webContents.executeJavaScript(`
        (function() {
          const elements = Array.from(
            document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"]')
          );

          // Tag each element with a unique index for reliable selection
          elements.forEach((el, idx) => {
            el.setAttribute('data-blueberry-index', idx.toString());
          });

          return elements
            .map((el, index) => {
              const tag = el.tagName.toLowerCase();
              const id = el.id;
              const classes = Array.from(el.classList);
              const text = el.textContent?.trim() || '';
              const ariaLabel = el.getAttribute('aria-label') || '';
              const placeholder = el.getAttribute('placeholder') || '';
              const type = el.getAttribute('type');
              const role = el.getAttribute('role');

              // Check if this is a cookie-related button (high priority)
              const textLower = text.toLowerCase();
              const isCookieButton = textLower.includes('cookie') ||
                                      textLower.includes('consent') ||
                                      textLower.includes('accept all') ||
                                      textLower.includes('reject all');

              // Generate SPECIFIC selector (never just "button" or "a")
              let selector = '';

              // Priority 1: ID (most specific)
              if (id) {
                selector = '#' + id;
              }
              // Priority 2: Data-attribute selector for cookie buttons (they often lack good attributes)
              else if (isCookieButton && tag === 'button') {
                // Use data-blueberry-index for reliable selection
                selector = '[data-blueberry-index="' + index + '"]';
                return {
                  tag,
                  selector,
                  label: text,
                  text: text.substring(0, 100),
                  hasText: true,
                  isGeneric: false,
                  isCookieButton: true
                };
              }
              // Priority 3: Type attribute for inputs/buttons
              else if (type && (tag === 'button' || tag === 'input')) {
                selector = tag + '[type="' + type + '"]';
              }
              // Priority 4: Role attribute
              else if (role) {
                selector = tag + '[role="' + role + '"]';
              }
              // Priority 5: Classes (pick best one)
              else if (classes.length > 0) {
                // Pick most semantic class (avoid utility classes, module hashes)
                const goodClass = classes.find(c =>
                  !c.includes('_') &&           // Skip module hashes
                  !c.match(/^(mr|ml|mt|mb|p[trblxy]?|text|bg|w|h)-/) && // Skip Tailwind utilities
                  c.length < 30                 // Skip long generated classes
                ) || classes[0]; // Fallback to first class

                selector = tag + '.' + goodClass;
              }
              // Priority 6: Aria-label attribute
              else if (ariaLabel && ariaLabel.length < 50) {
                selector = tag + '[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
              }
              // Priority 7: data-blueberry-index as last resort (for elements with text but no good attributes)
              else if (text && text.length > 0 && text.length < 50) {
                selector = '[data-blueberry-index="' + index + '"]';
              }
              // Fallback: Just tag (will be filtered out below)
              else {
                selector = tag;
              }

              // Get best label (priority: aria-label > placeholder > text)
              const label = ariaLabel || placeholder || text;

              return {
                tag,
                selector,
                label: label.substring(0, 100), // Keep more context
                text: text.substring(0, 100), // Keep more text
                hasText: text.length > 0,
                isGeneric: selector === tag, // Flag generic selectors
                isCookieButton: isCookieButton || false
              };
            })
            .filter(el => (el.label || el.text) && !el.isGeneric) // Filter out generic selectors and elements without labels
            .sort((a, b) => {
              // Prioritize cookie buttons at the top
              if (a.isCookieButton && !b.isCookieButton) return -1;
              if (!a.isCookieButton && b.isCookieButton) return 1;
              return 0;
            })
            .slice(0, 18); // Limit to 18 most relevant elements - balanced between coverage and noise reduction
        })();
      `);

      return {
        title,
        url,
        interactiveElements: interactiveElements || [],
      };
    } catch (error) {
      log.error("[LLMExecutionEngine] Failed to capture page state", error);
      // Return minimal state
      return {
        title: "",
        url: tab.webContents.getURL(),
        interactiveElements: [],
      };
    }
  }

  /**
   * Sanitize input value to prevent XSS
   * AC 7: Sanitizes input values (no script injection)
   * Note: JSON.stringify handles quote escaping for both selectors and values,
   * so we only need to remove script tags from input values
   */
  private sanitizeInput(input: string | null): string {
    // Handle null/undefined input
    if (!input) return "";

    // Remove script tags for XSS prevention
    // JSON.stringify will handle quote escaping automatically
    return input
      .replace(/<script[^>]*>.*?<\/script>/gi, "")
      .replace(/<\/?\s*script[^>]*>/gi, "");
  }

  /**
   * Detect if action sequence is repeating (infinite loop detection)
   * Checks if last 6 actions form a pattern like "A,B,C,A,B,C"
   */
  private isRepeatingPattern(actionSequence: string): boolean {
    const actions = actionSequence.split(",");
    if (actions.length < 6) return false;

    // Check if first half matches second half (e.g., "navigate,type,click" === "navigate,type,click")
    const half = Math.floor(actions.length / 2);
    const firstHalf = actions.slice(0, half).join(",");
    const secondHalf = actions.slice(half, half * 2).join(",");

    return firstHalf === secondHalf && firstHalf.length > 0;
  }

  /**
   * Extract content from page if workflow indicates copy/extract action
   * Analyzes workflow steps to determine if current page has content to extract
   * Returns extracted content for use in subsequent steps
   */
  private async extractContentIfNeeded(
    workflow: unknown,
    _pageState: PageState,
    tab: Tab,
  ): Promise<string | undefined> {
    try {
      if (typeof workflow !== "object" || workflow === null) {
        return undefined;
      }

      const workflowObj = workflow as Record<string, unknown>;

      // Check if workflow has steps with copy/extract actions
      if (Array.isArray(workflowObj.steps)) {
        const steps = workflowObj.steps as Array<Record<string, unknown>>;

        // Find copy/extract actions for the current URL
        const copyActions = steps.filter(
          (step) =>
            step.action === "copy" ||
            step.action === "extract" ||
            (typeof step.action === "string" &&
              step.action.toLowerCase().includes("copy")),
        );

        if (copyActions.length === 0) {
          return undefined;
        }

        // Extract content from interactive elements or page headings
        // Focus on headings, titles, and prominent text content
        const extractedTexts = await tab.webContents.executeJavaScript(`
          (function() {
            // Extract from headings (h1, h2, h3) - most likely to be product titles, article titles, etc.
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(el => el.textContent?.trim())
              .filter(text => text && text.length > 0 && text.length < 100)
              .slice(0, 5); // Top 5 headings

            // Extract from elements with common content classes
            const contentElements = Array.from(
              document.querySelectorAll('[class*="title"], [class*="name"], [class*="heading"], [data-id]')
            )
              .map(el => el.textContent?.trim())
              .filter(text => text && text.length > 0 && text.length < 100)
              .slice(0, 5); // Top 5 content elements

            // Combine and deduplicate
            const allTexts = [...new Set([...headings, ...contentElements])];
            return allTexts.slice(0, 3); // Return top 3 unique texts
          })()
        `);

        if (Array.isArray(extractedTexts) && extractedTexts.length > 0) {
          const extracted = extractedTexts.join(" | ");
          log.info(
            `[LLMExecutionEngine] Extracted content from page: "${extracted.substring(0, 100)}..."`,
          );
          return extracted;
        }
      }

      return undefined;
    } catch (error) {
      log.error(
        "[LLMExecutionEngine] Failed to extract content from page:",
        error,
      );
      return undefined;
    }
  }

  /**
   * Emit progress update to sidebar
   * AC 2: Progress updates with step count and description
   * AC 5: Progress includes screenshot thumbnail for user visibility
   */
  private emitProgress(
    action: string,
    stepCount: number,
    description: string,
    estimatedTotal?: number,
    screenshotBase64?: string,
  ): void {
    if (this.onProgress) {
      this.onProgress(
        stepCount,
        estimatedTotal || stepCount,
        description,
        screenshotBase64,
      );
    }

    log.info("[LLMExecutionEngine] Progress", {
      action,
      step: stepCount,
      description,
      hasScreenshot: !!screenshotBase64,
    });
  }

  /**
   * Cancel execution (called by user)
   * AC 5: User can cancel execution at any time
   */
  public cancel(): void {
    this.isCancelled = true;
    log.info("[LLMExecutionEngine] Execution cancelled by user");
  }
}
