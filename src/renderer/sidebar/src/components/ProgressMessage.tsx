import React from "react";
import { Loader, X } from "lucide-react";
import { Button } from "@common/components/Button";

// Note: electron-log not available in renderer, using console.error for logging

/**
 * ProgressMessage Component
 * Story 1.14: AI-Powered Automation Suggestions
 *
 * Displays real-time execution progress for automation workflows.
 * Shows current step, total steps, progress bar, and current action description.
 * User can cancel mid-execution with [Cancel] button.
 *
 * Flow:
 * 1. AutomationExecutor.executeWithProgress() emits execution:progress IPC events
 * 2. Component receives updates and displays progress: "Processing 3/10... 7/10..."
 * 3. User can click [Cancel] button → sends pattern:cancel-execution IPC
 * 4. On completion, execution:complete event is received (handled by parent Chat component)
 *
 * UX Design:
 * - Blue accent for ongoing automation execution
 * - Animated spinner (Loader icon)
 * - Progress bar showing completion percentage
 * - Current action description (e.g., "Navigating to page 3...")
 * - [Cancel] button for mid-execution cancellation
 */

interface ProgressMessageProps {
  executionId: string; // Unique execution ID for cancellation
  current: number; // Current step number (1-indexed)
  total: number; // Total number of steps
  currentAction: string; // Human-readable description of current action
  onCancel: () => void; // Called when [Cancel] button is clicked
  onError: (error: string) => void; // Error callback
}

export const ProgressMessage: React.FC<ProgressMessageProps> = ({
  executionId,
  current,
  total,
  currentAction,
  onCancel,
  onError,
}) => {
  const [isCancelling, setIsCancelling] = React.useState(false);

  // Calculate progress percentage (0-100)
  const progress = Math.min(100, Math.max(0, (current / total) * 100));

  /**
   * AC 4: [Cancel] button handler
   * Sends pattern:cancel-execution IPC to stop automation mid-execution
   */
  const handleCancel = async (): Promise<void> => {
    setIsCancelling(true);
    try {
      // Call pattern:cancel-execution IPC (validated in EventManager.ts)
      const result = await window.sidebarAPI.pattern.cancelExecution({
        executionId,
      });

      if (!result.success) {
        throw new Error(result.error?.message || "Failed to cancel execution");
      }

      // Success - cancellation initiated
      onCancel();
    } catch (error) {
      console.error("[ProgressMessage] Cancel execution error:", error);
      onError(
        error instanceof Error ? error.message : "Failed to cancel execution",
      );
      setIsCancelling(false); // Re-enable cancel button on error
    }
  };

  return (
    <div className="relative w-full animate-fade-in">
      {/* Progress Message Container - Blue accent for active execution (AC 3) */}
      <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 p-5">
        {/* Header with animated spinner (AC 3) */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 mt-1">
            <Loader className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
          </div>
          <div className="flex-1">
            {/* Progress text: "Processing 3/10... 7/10..." (AC 3) */}
            <p className="text-sm font-medium text-foreground">
              Processing {current}/{total}...
            </p>
            {/* Current action description (AC 3, 4) */}
            <p className="text-xs text-muted-foreground mt-1">
              {currentAction}
            </p>
          </div>
        </div>

        {/* Progress bar (visual indicator) (AC 3) */}
        <div className="mt-3 pl-8">
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {/* Progress percentage text */}
          <p className="text-xs text-muted-foreground mt-1 text-center">
            {progress.toFixed(0)}% complete
          </p>
        </div>

        {/* Cancel button (AC 4) */}
        <div className="mt-4 pl-8">
          <Button
            onClick={() => void handleCancel()}
            disabled={isCancelling}
            variant="secondary"
            size="sm"
          >
            <X className="w-4 h-4 mr-1" />
            {isCancelling ? "Cancelling..." : "Cancel"}
          </Button>
        </div>

        {/* Execution metadata - small text */}
        <div className="mt-3 pl-8 text-xs text-muted-foreground">
          Execution ID: {executionId.slice(0, 12)}...
        </div>
      </div>
    </div>
  );
};
