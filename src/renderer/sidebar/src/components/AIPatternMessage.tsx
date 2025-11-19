import React, { useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { Button } from "@common/components/Button";
import { useNotifications } from "../hooks/useNotifications";

// Note: electron-log not available in renderer, using console.error for logging

/**
 * AIPatternMessage Component
 * Story 1.13: Conversational AI Pattern Notifications
 *
 * Displays AI-generated conversational pattern notifications with inline action buttons.
 * Uses intent summaries from Story 1.12 (IntentSummarizer) for natural, context-aware messaging.
 *
 * Flow:
 * 1. User clicks topbar notification → sidebar opens with this component
 * 2. Displays friendly AI message: "Hey! I've noticed you're [intent]. Want to automate this?"
 * 3. User clicks action button:
 *    - [Yes, Automate]: Opens save modal, pre-fills with intent summaries
 *    - [No Thanks]: Marks pattern as dismissed (patterns.dismissed=1)
 *
 * UX Design:
 * - Light blue background (#EBF8FF light mode, #1E3A5F dark mode)
 * - Sparkles icon for AI avatar
 * - Inline action buttons (not modal dialogs)
 * - Non-blocking, friendly tone
 */

interface AIPatternMessageProps {
  content: string; // AI-generated conversational message (uses detailed summary)
  patternId: string; // Pattern ID for IPC operations
  patternData: {
    id: string;
    patternType: "navigation" | "form" | "copy-paste";
    confidence: number;
    occurrenceCount: number;
    intentSummary?: string; // SHORT summary (20-30 words) from IntentSummarizer
    intentSummaryDetailed?: string; // DETAILED summary (40-50 words) from IntentSummarizer
    patternData?: {
      sequence?: Array<{ url: string }>;
      domain?: string;
      fields?: Array<unknown>;
    };
  };
  notificationId: string; // For dismissing notification after action
  onDismiss: () => void; // Called when message is dismissed (hide UI)
  onAutomationSaved: (message: string) => void; // Success callback
  onError: (error: string) => void; // Error callback
}

export const AIPatternMessage: React.FC<AIPatternMessageProps> = ({
  content,
  patternId,
  patternData,
  notificationId,
  onDismiss,
  onAutomationSaved,
  onError,
}) => {
  const { dismissNotification } = useNotifications();
  const [showForm, setShowForm] = useState(false);
  const [automationName, setAutomationName] = useState(
    patternData.intentSummary || "",
  );
  const [automationDescription, setAutomationDescription] = useState(
    patternData.intentSummaryDetailed || "",
  );
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * AC 4: [Yes, Automate] button handler
   * Opens save form pre-filled with intent summaries
   */
  const handleAutomateClick = (): void => {
    setShowForm(true);
  };

  /**
   * AC 5: [No Thanks] button handler
   * Dismisses pattern (marks patterns.dismissed=1) and removes notification
   */
  const handleNoThanksClick = async (): Promise<void> => {
    setIsProcessing(true);
    try {
      // Call pattern:dismiss IPC (updates patterns.dismissed=1)
      await window.sidebarAPI.pattern.dismiss({ patternId });

      // Dismiss notification from topbar
      await dismissNotification(notificationId);

      // AI response confirmation (AC 5)
      onAutomationSaved("No problem! I won't suggest this again.");
      onDismiss();
    } catch (error) {
      console.error("[AIPatternMessage] Dismiss pattern error:", error);
      onError("Failed to dismiss pattern");
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * AC 4: Save automation handler
   * Validates inputs and calls pattern:save-automation IPC (from Story 1.10)
   */
  const handleSaveAutomation = async (): Promise<void> => {
    if (!automationName.trim()) {
      onError("Automation name is required");
      return;
    }

    if (automationName.length > 100) {
      onError("Automation name must be 100 characters or less");
      return;
    }

    if (automationDescription.length > 500) {
      onError("Description must be 500 characters or less");
      return;
    }

    setIsProcessing(true);
    try {
      // Call pattern:save-automation IPC (existing from Story 1.10)
      const result = await window.sidebarAPI.pattern.saveAutomation({
        pattern_id: patternId,
        name: automationName.trim(),
        description: automationDescription.trim() || undefined,
      });

      if (!result.success) {
        throw new Error(result.error?.message || "Failed to save automation");
      }

      // Dismiss notification from topbar (AC 4)
      await dismissNotification(notificationId);

      // Success message (AC 4)
      onAutomationSaved(
        `Great! Saved as '${automationName}'. Find it in your Automation Library.`,
      );
      onDismiss();
    } catch (error) {
      console.error("[AIPatternMessage] Save automation error:", error);
      onError(
        error instanceof Error ? error.message : "Failed to save automation",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative w-full animate-fade-in">
      {/* AI Pattern Message Container - Distinctive AI styling (AC 2) */}
      <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 p-5">
        {/* Header with Sparkles AI avatar (AC 2) */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 mt-1">
            <Sparkles className="w-5 h-5 text-blue-500 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            {/* AI conversational message content (AC 2) */}
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
        </div>

        {/* Action buttons or save form (AC 3, 4) */}
        {showForm ? (
          <div className="mt-4 space-y-3 pl-8">
            {/* Pre-filled with SHORT summary (AC 4) */}
            <input
              type="text"
              placeholder="Automation name *"
              value={automationName}
              onChange={(e) => setAutomationName(e.target.value)}
              maxLength={100}
              disabled={isProcessing}
              className="w-full px-4 py-2 border border-border rounded-lg
                       bg-background dark:bg-muted/50 text-foreground
                       placeholder:text-muted-foreground
                       focus:outline-none focus:ring-2 focus:ring-blue-500
                       disabled:opacity-50"
            />
            {/* Pre-filled with DETAILED summary (AC 4) */}
            <textarea
              placeholder="Description (optional)"
              value={automationDescription}
              onChange={(e) => setAutomationDescription(e.target.value)}
              maxLength={500}
              rows={3}
              disabled={isProcessing}
              className="w-full px-4 py-2 border border-border rounded-lg
                       bg-background dark:bg-muted/50 text-foreground
                       placeholder:text-muted-foreground
                       focus:outline-none focus:ring-2 focus:ring-blue-500
                       disabled:opacity-50 resize-none"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleSaveAutomation}
                disabled={isProcessing}
                variant="default"
                size="sm"
              >
                {isProcessing ? "Saving..." : "Save Automation"}
              </Button>
              <Button
                onClick={() => setShowForm(false)}
                disabled={isProcessing}
                variant="secondary"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mt-4 pl-8">
            {/* AC 3: [Yes, Automate] button - primary styling (prominent) */}
            <Button
              onClick={handleAutomateClick}
              disabled={isProcessing}
              variant="default"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Check className="w-4 h-4 mr-1" />
              Yes, Automate
            </Button>
            {/* AC 3: [No Thanks] button - secondary styling (de-emphasized) */}
            <Button
              onClick={handleNoThanksClick}
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
          {patternData.patternType === "navigation"
            ? "Navigation"
            : patternData.patternType === "form"
              ? "Form"
              : "Copy/Paste"}{" "}
          pattern • {patternData.confidence.toFixed(0)}% confidence •{" "}
          {patternData.occurrenceCount} occurrence
          {patternData.occurrenceCount !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
};
