import log from "electron-log";
import type { Window } from "./Window";
import { Tab } from "./Tab";

/**
 * Navigation pattern structure from pattern detection
 */
interface NavigationPattern {
  sequence: Array<{
    url: string;
    timestamp: number;
    tabId: string;
  }>;
  sessionGap: number;
}

/**
 * Form pattern structure from pattern detection
 */
interface FormPattern {
  domain: string;
  formSelector: string;
  fields: Array<{
    name: string;
    valuePattern: string; // 'email', 'name', 'phone', 'number', 'text'
    label?: string; // Enhanced context for AI (Story 1.12)
    sanitizedValue?: string; // Actual value for non-sensitive fields (Story 1.12)
  }>;
}

/**
 * Progress callback function type
 */
type ProgressCallback = (
  step: number,
  total: number,
  description: string,
) => void;

/**
 * Execution result type
 */
interface ExecutionResult {
  success: boolean;
  stepsExecuted: number;
  duration: number;
  error?: string;
}

/**
 * Execution state tracking (Story 1.14)
 */
interface ExecutionState {
  executionId: string;
  cancelled: boolean;
  currentStep: number;
  totalSteps: number;
  patternType: "navigation" | "form";
}

/**
 * AutomationExecutor handles pattern replay for saved automations.
 * Supports navigation sequences and form filling patterns.
 * Story 1.14: Added cancellation and real-time progress tracking.
 */
export class AutomationExecutor {
  private window: Window;
  private executionStates: Map<string, ExecutionState> = new Map();

  constructor(window: Window) {
    this.window = window;
  }

  /**
   * Execute an automation pattern
   */
  async execute(
    automationId: string,
    patternType: "navigation" | "form",
    patternData: NavigationPattern | FormPattern,
    onProgress?: ProgressCallback,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      log.info(
        `[AutomationExecutor] Starting execution: ${automationId} (${patternType})`,
      );

      let result: { success: boolean; stepsExecuted: number };

      if (patternType === "navigation") {
        result = await this.executeNavigation(
          automationId,
          patternData as NavigationPattern,
          onProgress,
        );
      } else if (patternType === "form") {
        result = await this.executeForm(
          automationId,
          patternData as FormPattern,
          onProgress,
        );
      } else {
        throw new Error(`Unknown pattern type: ${patternType}`);
      }

      const duration = Date.now() - startTime;

      log.info(
        `[AutomationExecutor] Execution completed: ${automationId} (${result.stepsExecuted} steps in ${duration}ms)`,
      );

      return {
        ...result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      log.error(
        `[AutomationExecutor] Execution failed: ${automationId}`,
        error,
      );

      return {
        success: false,
        stepsExecuted: 0,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute navigation pattern (URL sequence replay)
   * @param existingTab Optional tab to reuse (for multi-iteration execution)
   */
  private async executeNavigation(
    _automationId: string,
    pattern: NavigationPattern,
    onProgress?: ProgressCallback,
    existingTab?: Tab | null,
  ): Promise<{ success: boolean; stepsExecuted: number; tab?: Tab }> {
    const totalSteps = pattern.sequence.length;
    let tab: Tab | null = existingTab || null;

    log.info(
      `[AutomationExecutor] Executing navigation pattern: ${totalSteps} steps${existingTab ? " (reusing tab)" : ""}`,
    );

    for (let i = 0; i < totalSteps; i++) {
      const step = pattern.sequence[i];
      const stepNum = i + 1;

      try {
        const hostname = new URL(step.url).hostname;
        log.info(
          `[AutomationExecutor] Navigation step ${stepNum}/${totalSteps}: ${hostname}`,
        );

        // Report progress
        if (onProgress) {
          onProgress(stepNum, totalSteps, `Navigating to ${hostname}...`);
        }

        // Create tab on first step if no existing tab, reuse for subsequent steps
        if (!tab) {
          tab = this.window.createTab(step.url);
          // Enable automation mode to skip pattern tracking and show overlay
          tab.setAutomationMode(true);
        } else {
          await tab.loadURL(step.url);
        }

        // Wait 1 second between navigations (as per AC-4)
        await this.delay(1000);
      } catch (error) {
        // Disable automation mode before throwing error
        if (tab) {
          tab.setAutomationMode(false);
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Map common navigation errors to user-friendly messages
        if (errorMessage.includes("ERR_NAME_NOT_RESOLVED")) {
          throw new Error("Page not found. Check if URL changed.");
        } else if (errorMessage.includes("ERR_CONNECTION_TIMED_OUT")) {
          throw new Error("Page took too long to load. Try again later.");
        } else {
          throw new Error(`Failed to navigate to ${step.url}: ${errorMessage}`);
        }
      }
    }

    // Return tab for reuse, but don't disable automation mode yet
    // (will be disabled after all iterations complete)
    return { success: true, stepsExecuted: totalSteps, tab: tab || undefined };
  }

  /**
   * Execute form pattern (form fill replay)
   */
  private async executeForm(
    _automationId: string,
    pattern: FormPattern,
    onProgress?: ProgressCallback,
  ): Promise<{ success: boolean; stepsExecuted: number }> {
    const totalSteps = pattern.fields.length + 2; // +1 for navigation, +1 for submit
    let stepNum = 1;

    log.info(
      `[AutomationExecutor] Executing form pattern: ${pattern.domain} (${pattern.fields.length} fields)`,
    );

    // Step 1: Navigate to form page
    if (onProgress) {
      onProgress(stepNum, totalSteps, `Navigating to ${pattern.domain}...`);
    }

    const formUrl = `https://${pattern.domain}`;
    const tab = this.window.createTab(formUrl);

    try {
      await tab.loadURL(formUrl);
      // Wait 2 seconds for page load (increased from navigation delay)
      await this.delay(2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (errorMessage.includes("ERR_NAME_NOT_RESOLVED")) {
        throw new Error("Page not found. Check if URL changed.");
      } else {
        throw new Error(`Failed to navigate to form page: ${formUrl}`);
      }
    }

    // Step 2-N: Fill form fields
    for (const field of pattern.fields) {
      stepNum++;

      if (onProgress) {
        onProgress(stepNum, totalSteps, `Filling field "${field.name}"...`);
      }

      // Use sanitized value if available (Story 1.12), otherwise generate sample value
      const generatedValue =
        field.sanitizedValue ||
        this.generateValueForPattern(field.valuePattern);

      // Construct JavaScript to fill form field
      const script = `
        (function() {
          const field = document.querySelector('${pattern.formSelector} [name="${field.name}"]');
          if (!field) {
            throw new Error('Field not found: ${field.name}');
          }
          field.value = '${generatedValue.replace(/'/g, "\\'")}'; // Escape single quotes
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })();
      `;

      try {
        await tab.runJs(script);
        log.info(
          `[AutomationExecutor] Filled field: ${field.name} = ${generatedValue}`,
        );
        // Wait 500ms between field fills
        await this.delay(500);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("Field not found")) {
          throw new Error("Form not found on page. Website may have changed.");
        } else {
          throw new Error(
            `Failed to fill field "${field.name}": ${errorMessage}`,
          );
        }
      }
    }

    // Step N+1: Submit the form
    stepNum++;
    if (onProgress) {
      onProgress(stepNum, totalSteps, "Submitting form...");
    }

    try {
      // Try to submit the form - look for submit button or use form.submit()
      const submitScript = `
        (function() {
          const form = document.querySelector('${pattern.formSelector}');
          if (!form) {
            throw new Error('Form not found for submission');
          }

          // Try to find and click submit button first (preferred method)
          const submitButton = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
          if (submitButton) {
            submitButton.click();
            return 'clicked submit button';
          }

          // Fallback: call form.submit()
          form.submit();
          return 'called form.submit()';
        })();
      `;

      const submitResult = await tab.runJs(submitScript);
      log.info(`[AutomationExecutor] Form submitted: ${submitResult}`);

      // Wait for navigation after submission
      await this.delay(2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to submit form: ${errorMessage}`);
    }

    return { success: true, stepsExecuted: totalSteps };
  }

  /**
   * Generate sample values for anonymized field patterns
   */
  private generateValueForPattern(pattern: string): string {
    switch (pattern) {
      case "email":
        return "user@example.com";
      case "name":
        return "John Doe";
      case "phone":
        return "555-1234";
      case "number":
        return "12345";
      case "text":
      default:
        return "Sample text";
    }
  }

  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel an ongoing execution (Story 1.14)
   * @param executionId Execution ID to cancel
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      const state = this.executionStates.get(executionId);
      if (!state) {
        log.warn(`[AutomationExecutor] No execution found: ${executionId}`);
        return;
      }

      // Mark as cancelled
      state.cancelled = true;
      this.executionStates.set(executionId, state);

      log.info(
        `[AutomationExecutor] Execution ${executionId} cancelled at step ${state.currentStep}/${state.totalSteps}`,
      );

      // Emit cancellation event to sidebar
      this.window.sidebar.view.webContents.send(
        "automation:execution-cancelled",
        {
          executionId,
          stoppedAt: state.currentStep,
          totalSteps: state.totalSteps,
        },
      );

      // Cleanup state (will be removed when execution completes naturally)
    } catch (error) {
      log.error("[AutomationExecutor] Cancel execution error:", error);
      throw error;
    }
  }

  /**
   * Extract one iteration of a navigation pattern by detecting pattern repetition
   * Finds when the sequence returns to the starting domain after visiting other domains
   */
  private extractOneIteration(pattern: NavigationPattern): Array<{
    url: string;
    timestamp: number;
    tabId: string;
  }> {
    if (pattern.sequence.length === 0) {
      return [];
    }

    // If only 1 URL, that's the iteration
    if (pattern.sequence.length === 1) {
      return [pattern.sequence[0]];
    }

    const iteration = [pattern.sequence[0]];

    try {
      // Extract starting domain
      const startingDomain = new URL(pattern.sequence[0].url).hostname;
      let visitedDifferentDomain = false;

      // Continue adding URLs until we return to the starting domain (after visiting elsewhere)
      for (let i = 1; i < pattern.sequence.length; i++) {
        const currentUrl = pattern.sequence[i].url;
        const currentDomain = new URL(currentUrl).hostname;

        // Track if we've left the starting domain
        if (currentDomain !== startingDomain) {
          visitedDifferentDomain = true;
        }

        iteration.push(pattern.sequence[i]);

        // Only consider it a "return" if we've been somewhere else first
        if (
          currentDomain === startingDomain &&
          visitedDifferentDomain &&
          i > 0
        ) {
          break;
        }
      }

      log.info(
        `[AutomationExecutor] Extracted one iteration: ${iteration.length} steps from ${pattern.sequence.length} total recorded steps (returning to ${startingDomain})`,
      );
    } catch (error) {
      log.error("[AutomationExecutor] Error extracting iteration:", error);
      // Fallback: return first element if URL parsing fails
      return [pattern.sequence[0]];
    }

    return iteration;
  }

  /**
   * Execute automation with real-time progress tracking (Story 1.14)
   * Used for proactive suggestions (mid-workflow continuation)
   * @param patternId Pattern ID to execute
   * @param patternType Pattern type (navigation or form)
   * @param patternData Pattern data structure
   * @param itemCount Number of times to repeat the pattern
   * @returns Execution ID for tracking
   */
  async executeWithProgress(
    patternId: string,
    patternType: "navigation" | "form",
    patternData: NavigationPattern | FormPattern,
    itemCount: number,
  ): Promise<string> {
    const executionId = `execution-${Date.now()}`;

    try {
      // Extract one iteration for navigation patterns (not the full recorded history)
      let navigationIteration: NavigationPattern | undefined;

      if (patternType === "navigation") {
        const fullPattern = patternData as NavigationPattern;
        const iteration = this.extractOneIteration(fullPattern);

        // Create a new NavigationPattern with just one iteration
        navigationIteration = {
          sequence: iteration,
          sessionGap: fullPattern.sessionGap,
        };
      }

      // Initialize execution state
      const totalSteps =
        patternType === "navigation"
          ? navigationIteration!.sequence.length * itemCount
          : (patternData as FormPattern).fields.length * itemCount;

      const state: ExecutionState = {
        executionId,
        cancelled: false,
        currentStep: 0,
        totalSteps,
        patternType,
      };

      this.executionStates.set(executionId, state);

      log.info(
        `[AutomationExecutor] Starting execution ${executionId}: ${patternType} pattern, ${itemCount} iterations, ${totalSteps} total steps`,
      );

      // Execute pattern multiple times (reusing same tab for navigation patterns)
      let reusableTab: Tab | null = null;

      for (let iteration = 0; iteration < itemCount; iteration++) {
        // Check for cancellation before each iteration
        const currentState = this.executionStates.get(executionId);
        if (currentState?.cancelled) {
          log.info(
            `[AutomationExecutor] Execution ${executionId} cancelled at iteration ${iteration + 1}/${itemCount}`,
          );
          // Disable automation mode on tab before cleanup
          if (reusableTab) {
            reusableTab.setAutomationMode(false);
          }
          this.executionStates.delete(executionId);
          return executionId;
        }

        // Progress callback for this iteration
        const onProgress = (
          step: number,
          _total: number,
          description: string,
        ): void => {
          const globalStep =
            iteration *
              (patternType === "navigation"
                ? navigationIteration!.sequence.length
                : (patternData as FormPattern).fields.length) +
            step;

          // Update state
          const state = this.executionStates.get(executionId);
          if (state) {
            state.currentStep = globalStep;
            this.executionStates.set(executionId, state);
          }

          // Emit progress event to sidebar
          this.window.sidebar.view.webContents.send("execution:progress", {
            executionId,
            current: globalStep,
            total: totalSteps,
            action: description,
            iteration: iteration + 1,
            totalIterations: itemCount,
          });
        };

        // Execute single iteration (reusing tab for navigation patterns)
        if (patternType === "navigation") {
          const result = await this.executeNavigation(
            patternId,
            navigationIteration!,
            onProgress,
            reusableTab,
          );
          // Store tab for reuse in next iteration
          if (result.tab) {
            reusableTab = result.tab;
          }
        } else {
          // Form patterns create new tab each time (as per original design)
          await this.execute(patternId, patternType, patternData, onProgress);
        }

        // Small delay between iterations
        if (iteration < itemCount - 1) {
          await this.delay(500);
        }
      }

      // Disable automation mode after all iterations complete
      if (reusableTab) {
        reusableTab.setAutomationMode(false);
      }

      // Emit completion event with pattern context (Story 1.14 - enhanced UX)
      const patternContext =
        patternType === "navigation"
          ? {
              type: "navigation" as const,
              urlCount: navigationIteration!.sequence.length,
              firstUrl: navigationIteration!.sequence[0]?.url,
              lastUrl:
                navigationIteration!.sequence[
                  navigationIteration!.sequence.length - 1
                ]?.url,
            }
          : {
              type: "form" as const,
              domain: (patternData as FormPattern).domain,
              fieldCount: (patternData as FormPattern).fields.length,
            };

      this.window.sidebar.view.webContents.send("execution:complete", {
        executionId,
        itemsProcessed: itemCount,
        stepsExecuted: totalSteps,
        patternContext,
      });

      log.info(
        `[AutomationExecutor] Execution ${executionId} completed: ${itemCount} iterations, ${totalSteps} steps`,
      );

      // Cleanup state
      this.executionStates.delete(executionId);

      return executionId;
    } catch (error) {
      log.error("[AutomationExecutor] Execution error:", error);

      // Emit error event
      this.window.sidebar.view.webContents.send("execution:error", {
        executionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Cleanup state
      this.executionStates.delete(executionId);

      throw error;
    }
  }
}
