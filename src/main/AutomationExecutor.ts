import log from "electron-log";
import { Window } from "./Window";
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
 * AutomationExecutor handles pattern replay for saved automations.
 * Supports navigation sequences and form filling patterns.
 */
export class AutomationExecutor {
  private window: Window;

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
   */
  private async executeNavigation(
    _automationId: string,
    pattern: NavigationPattern,
    onProgress?: ProgressCallback,
  ): Promise<{ success: boolean; stepsExecuted: number }> {
    const totalSteps = pattern.sequence.length;
    let tab: Tab | null = null;

    log.info(
      `[AutomationExecutor] Executing navigation pattern: ${totalSteps} steps`,
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

        // Create tab on first step, reuse for subsequent steps
        if (i === 0) {
          tab = this.window.createTab(step.url);
          // Enable automation mode to skip pattern tracking and show overlay
          tab.setAutomationMode(true);
        } else if (tab) {
          await tab.loadURL(step.url);
        } else {
          throw new Error("Tab is null, cannot navigate");
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

    // Disable automation mode after successful completion
    if (tab) {
      tab.setAutomationMode(false);
    }

    return { success: true, stepsExecuted: totalSteps };
  }

  /**
   * Execute form pattern (form fill replay)
   */
  private async executeForm(
    _automationId: string,
    pattern: FormPattern,
    onProgress?: ProgressCallback,
  ): Promise<{ success: boolean; stepsExecuted: number }> {
    const totalSteps = pattern.fields.length + 1; // +1 for navigation step
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

      const generatedValue = this.generateValueForPattern(field.valuePattern);

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
}
