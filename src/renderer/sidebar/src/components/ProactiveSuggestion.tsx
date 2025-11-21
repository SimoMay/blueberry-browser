import React, { useState } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@common/components/Button";

// Note: electron-log not available in renderer, using console.error for logging

/**
 * ProactiveSuggestion Component
 * Story 1.14: AI-Powered Automation Suggestions
 *
 * Displays mid-workflow proactive suggestions when user performs 2-3 iterations of a pattern.
 * Offers to continue automation execution with customizable item count.
 *
 * Flow:
 * 1. PatternRecognizer detects 2-3 iterations → sends pattern:suggest-continuation IPC
 * 2. Displays friendly suggestion: "Looks like you're [intent]. Want me to continue for the next [N] items?"
 * 3. User clicks action button:
 *    - [Yes, continue]: Start automation with estimated item count
 *    - [Stop after N]: Show input for custom count, then start automation
 *    - [No Thanks]: Dismiss suggestion
 *
 * UX Design:
 * - Green accent for proactive/action-oriented messaging (vs blue for reactive notifications)
 * - Play icon for automation execution
 * - Inline action buttons (not modal dialogs)
 * - Non-blocking, dismissible
 */

interface ProactiveSuggestionProps {
  patternId: string; // Pattern ID for starting automation
  intentSummary: string; // SHORT summary from IntentSummarizer (20-30 words)
  estimatedItems: number; // Heuristic estimate of remaining items (default 5-10)
  matchCount: number; // Number of iterations detected (2-3)
  onDismiss: () => void; // Called when suggestion is dismissed (hide UI)
  onStarted: () => void; // Called when automation execution starts
  onError: (error: string) => void; // Error callback
}

export const ProactiveSuggestion: React.FC<ProactiveSuggestionProps> = ({
  patternId,
  intentSummary,
  estimatedItems,
  matchCount,
  onDismiss,
  onStarted,
  onError,
}) => {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customCount, setCustomCount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * AC 2, 3: [Yes, continue] button handler
   * Starts automation execution with estimated item count
   */
  const handleContinue = async (itemCount: number): Promise<void> => {
    if (itemCount < 1 || itemCount > 100) {
      onError("Item count must be between 1 and 100");
      return;
    }

    setIsProcessing(true);
    try {
      // Call onStarted immediately to show "Starting automation" message
      // BEFORE waiting for execution to complete (Story 1.14 - fix message ordering)
      onStarted();

      // Call pattern:start-continuation IPC (validated in EventManager.ts)
      const result = await window.sidebarAPI.pattern.startContinuation({
        patternId,
        itemCount,
      });

      if (!result.success) {
        throw new Error(result.error?.message || "Failed to start automation");
      }

      // Success - automation execution completed
      onDismiss();
    } catch (error) {
      console.error("[ProactiveSuggestion] Start continuation error:", error);
      onError(
        error instanceof Error ? error.message : "Failed to start automation",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * AC 2: [Stop after N] button handler
   * Shows custom input for user-specified item count
   */
  const handleCustomCountClick = (): void => {
    setShowCustomInput(true);
    setCustomCount(String(estimatedItems)); // Pre-fill with estimated count
  };

  /**
   * AC 2: Custom count submission
   * Validates input and starts automation with custom count
   */
  const handleCustomCountSubmit = async (): Promise<void> => {
    const count = parseInt(customCount, 10);
    if (isNaN(count) || count < 1 || count > 100) {
      onError("Please enter a number between 1 and 100");
      return;
    }
    await handleContinue(count);
  };

  /**
   * AC 6: [No Thanks] button handler
   * Dismisses suggestion without marking pattern as dismissed
   */
  const handleNoThanks = (): void => {
    onDismiss();
  };

  return (
    <div className="relative w-full animate-fade-in">
      {/* Proactive Suggestion Container - Green accent for action-oriented (AC 6) */}
      <div className="rounded-2xl border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/50 p-5">
        {/* Header with Play icon for automation (AC 2) */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 mt-1">
            <Play className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            {/* Proactive suggestion message (AC 2) */}
            <p className="text-sm text-foreground leading-relaxed">
              Looks like you&apos;re {intentSummary.toLowerCase()}. Want me to
              continue for the next {estimatedItems} items?
            </p>
          </div>
        </div>

        {/* Action buttons or custom input (AC 2, 3, 6) */}
        {showCustomInput ? (
          <div className="mt-4 space-y-3 pl-8">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                placeholder="Enter count (1-100)"
                disabled={isProcessing}
                className="flex-1 px-4 py-2 border border-border rounded-lg
                         bg-background dark:bg-muted/50 text-foreground
                         placeholder:text-muted-foreground
                         focus:outline-none focus:ring-2 focus:ring-green-500
                         disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isProcessing) {
                    void handleCustomCountSubmit();
                  }
                }}
              />
              <Button
                onClick={() => void handleCustomCountSubmit()}
                disabled={isProcessing || !customCount}
                variant="default"
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isProcessing ? "Starting..." : "Start"}
              </Button>
            </div>
            <Button
              onClick={() => setShowCustomInput(false)}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
            >
              Back
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mt-4 pl-8">
            {/* AC 3: [Yes, continue] button - primary green styling (prominent) */}
            <Button
              onClick={() => void handleContinue(estimatedItems)}
              disabled={isProcessing}
              variant="default"
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-1" />
              Yes, continue
            </Button>
            {/* AC 3: [Stop after N] button - shows custom input */}
            <Button
              onClick={handleCustomCountClick}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
            >
              Stop after N
            </Button>
            {/* AC 6: [No Thanks] button - dismissible */}
            <Button
              onClick={handleNoThanks}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
            >
              <X className="w-4 h-4 mr-1" />
              No Thanks
            </Button>
          </div>
        )}

        {/* Pattern metadata - small text (AC 2) */}
        <div className="mt-3 pl-8 text-xs text-muted-foreground">
          Pattern detected after {matchCount} iterations • Estimated{" "}
          {estimatedItems} remaining items
        </div>
      </div>
    </div>
  );
};
