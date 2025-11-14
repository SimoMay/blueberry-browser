import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@common/components/Button";
import { useNotifications } from "../hooks/useNotifications";

interface PatternActionMessageProps {
  content: string;
  patternId: string;
  patternData: {
    id: string;
    patternType: "navigation" | "form";
    confidence: number;
    occurrenceCount: number;
    patternData?: {
      sequence?: Array<{ url: string }>;
      domain?: string;
      fields?: Array<unknown>;
    };
  };
  notificationId: string;
  onDismiss: () => void;
  onAutomationSaved: (message: string) => void;
  onError: (error: string) => void;
}

export const PatternActionMessage: React.FC<PatternActionMessageProps> = ({
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
  const [automationName, setAutomationName] = useState("");
  const [automationDescription, setAutomationDescription] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConvert = (): void => {
    setShowForm(true);
  };

  const handleNotNow = (): void => {
    // Just dismiss the message UI, don't mark pattern as dismissed
    onDismiss();
  };

  const handleDismissPattern = async (): Promise<void> => {
    setIsProcessing(true);
    try {
      // Dismiss pattern in database
      await window.sidebarAPI.pattern.dismiss({ patternId });

      // Dismiss notification (updates both DB and local state)
      await dismissNotification(notificationId);

      onAutomationSaved("Pattern dismissed successfully");
      onDismiss();
    } catch (error) {
      console.error("[PatternActionMessage] Dismiss error:", error);
      onError("Failed to dismiss pattern");
    } finally {
      setIsProcessing(false);
    }
  };

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
      // Save automation to database
      const result = await window.sidebarAPI.pattern.saveAutomation({
        pattern_id: patternId,
        name: automationName.trim(),
        description: automationDescription.trim() || undefined,
      });

      // Check if save was successful
      if (!result.success) {
        throw new Error(result.error?.message || "Failed to save automation");
      }

      // Dismiss notification (updates both DB and local state)
      await dismissNotification(notificationId);

      onAutomationSaved(
        `Automation "${automationName}" created successfully! You can now execute it anytime.`,
      );
      onDismiss();
    } catch (error) {
      console.error("[PatternActionMessage] Save automation error:", error);
      onError(
        error instanceof Error ? error.message : "Failed to save automation",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative w-full animate-fade-in">
      {/* Pattern Action Message Container - Distinctive styling */}
      <div className="rounded-2xl border-2 border-primary/20 dark:border-primary/30 bg-primary/5 dark:bg-primary/10 p-5">
        {/* Header with icon */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 mt-1">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            {/* AI message content */}
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
        </div>

        {/* Action buttons or form */}
        {showForm ? (
          <div className="mt-4 space-y-3 pl-8">
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
                       focus:outline-none focus:ring-2 focus:ring-primary/50
                       disabled:opacity-50"
            />
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
                       focus:outline-none focus:ring-2 focus:ring-primary/50
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
            <Button
              onClick={handleConvert}
              disabled={isProcessing}
              variant="default"
              size="sm"
            >
              Convert to Automation
            </Button>
            <Button
              onClick={handleNotNow}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
            >
              Not Now
            </Button>
            <Button
              onClick={handleDismissPattern}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
            >
              Dismiss Pattern
            </Button>
          </div>
        )}

        {/* Pattern metadata - small text */}
        <div className="mt-3 pl-8 text-xs text-muted-foreground">
          {patternData.patternType === "navigation" ? "Navigation" : "Form"}{" "}
          pattern • {patternData.confidence.toFixed(0)}% confidence •{" "}
          {patternData.occurrenceCount} occurrences
        </div>
      </div>
    </div>
  );
};
