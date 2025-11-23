import React, { useState } from "react";
import { Zap, Eye, EyeOff } from "lucide-react";
import { Pattern } from "../contexts/PatternContext";
import { usePattern } from "../hooks/usePattern";
import { Badge } from "../../../common/components/Badge";
import { Modal } from "../../../common/components/Modal";
import { Button } from "../../../common/components/Button";
import { Toast } from "../../../common/components/Toast";
import { WorkflowDisplay } from "./WorkflowDisplay";

/**
 * PatternNotification component
 * Displays a badge with pattern count and opens modal to show pattern details
 */
export const PatternNotification: React.FC = () => {
  const { patterns, unacknowledgedCount, dismissPattern, saveAutomation } =
    usePattern();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [showConversionForm, setShowConversionForm] = useState(false);
  const [automationName, setAutomationName] = useState("");
  const [automationDescription, setAutomationDescription] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<
    "success" | "error" | "warning" | "info"
  >("success");
  const [showWorkflow, setShowWorkflow] = useState(false); // Story 1.19: Workflow preview toggle

  /**
   * Handle badge click - open modal with first pattern
   */
  const handleBadgeClick = (): void => {
    if (patterns.length > 0) {
      setSelectedPattern(patterns[0]);
      setModalOpen(true);
    }
  };

  /**
   * Handle dismiss button click
   */
  const handleDismiss = async (): Promise<void> => {
    if (!selectedPattern) return;

    try {
      await dismissPattern(selectedPattern.id);
      setModalOpen(false);
      setSelectedPattern(null);
      setShowConversionForm(false);
      setAutomationName("");
      setAutomationDescription("");

      setToastMessage("Pattern dismissed");
      setToastType("info");
      setShowToast(true);
    } catch {
      setToastMessage("Failed to dismiss pattern");
      setToastType("error");
      setShowToast(true);
    }
  };

  /**
   * Show conversion form
   */
  const handleConvertToAutomation = (): void => {
    setShowConversionForm(true);
  };

  /**
   * Handle save automation button click
   */
  const handleSaveAutomation = async (): Promise<void> => {
    if (!selectedPattern || !automationName.trim()) {
      setToastMessage("Automation name is required");
      setToastType("warning");
      setShowToast(true);
      return;
    }

    if (automationName.trim().length > 100) {
      setToastMessage("Automation name must be 100 characters or less");
      setToastType("warning");
      setShowToast(true);
      return;
    }

    if (automationDescription.length > 500) {
      setToastMessage("Description must be 500 characters or less");
      setToastType("warning");
      setShowToast(true);
      return;
    }

    try {
      await saveAutomation(
        selectedPattern.id,
        automationName.trim(),
        automationDescription.trim() || undefined,
      );

      setToastMessage("Automation saved successfully!");
      setToastType("success");
      setShowToast(true);

      // Close modal and reset state
      setModalOpen(false);
      setSelectedPattern(null);
      setShowConversionForm(false);
      setAutomationName("");
      setAutomationDescription("");
    } catch {
      setToastMessage("Failed to save automation");
      setToastType("error");
      setShowToast(true);
    }
  };

  /**
   * Generate plain-language pattern description
   * Story 1.19: Use LLM summaries instead of templates
   */
  const generatePatternDescription = (pattern: Pattern): string => {
    // Story 1.19: Use LLM-generated summaries (all patterns have them now)
    if (pattern.intentSummary) {
      return `I noticed you've been ${pattern.intentSummary.toLowerCase()}`;
    }

    // Fallback for legacy patterns (shouldn't happen after Story 1.19)
    if (pattern.type === "navigation") {
      const sequence = pattern.patternData?.sequence || [];
      if (sequence.length > 0) {
        const urls = sequence
          .slice(0, 3)
          .map((s) => {
            try {
              return new URL(s.url).hostname;
            } catch {
              return s.url;
            }
          })
          .join(" → ");
        return `You've navigated ${urls}${sequence.length > 3 ? "..." : ""} ${pattern.occurrenceCount} times`;
      }
      return `Navigation pattern detected ${pattern.occurrenceCount} times`;
    } else if (pattern.type === "form") {
      const domain = pattern.patternData?.domain || "a website";
      const fieldCount = pattern.patternData?.fields?.length || 0;
      return `You've filled out the ${domain} form with ${fieldCount} field${fieldCount !== 1 ? "s" : ""} ${pattern.occurrenceCount} times`;
    }
    return "Pattern detected";
  };

  /**
   * Get confidence score color
   */
  const getConfidenceColor = (confidence: number): string => {
    if (confidence > 80) return "text-green-500 dark:text-green-400";
    if (confidence > 70) return "text-yellow-500 dark:text-yellow-400";
    return "text-gray-500 dark:text-gray-400";
  };

  /**
   * Format timestamp
   */
  const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp).toLocaleString();
  };

  /**
   * Close modal handler
   */
  const handleCloseModal = (): void => {
    setModalOpen(false);
    setSelectedPattern(null);
    setShowConversionForm(false);
    setShowWorkflow(false); // Story 1.19: Reset workflow preview
    setAutomationName("");
    setAutomationDescription("");
  };

  // Don't render anything if no patterns
  if (unacknowledgedCount === 0) {
    return null;
  }

  return (
    <>
      {/* Badge button */}
      <div className="relative">
        <button
          onClick={handleBadgeClick}
          className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={`${unacknowledgedCount} pattern${unacknowledgedCount !== 1 ? "s" : ""} detected`}
        >
          <Zap className="w-5 h-5 text-blue-500 dark:text-blue-400" />
          <div className="absolute -top-1 -right-1">
            <Badge count={unacknowledgedCount} severity="info" pulse={true} />
          </div>
        </button>
      </div>

      {/* Pattern modal */}
      {modalOpen && selectedPattern && (
        <Modal
          isOpen={modalOpen}
          onClose={handleCloseModal}
          title="Pattern Detected"
        >
          <div className="space-y-4">
            {/* Pattern description */}
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {generatePatternDescription(selectedPattern)}
            </div>

            {/* Pattern metadata */}
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
                {selectedPattern.type === "navigation" ? "Navigation" : "Form"}
              </span>
              <span className={getConfidenceColor(selectedPattern.confidence)}>
                {selectedPattern.confidence.toFixed(0)}% confidence
              </span>
            </div>

            {/* Timestamps */}
            {(selectedPattern.firstSeen || selectedPattern.lastSeen) && (
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                {selectedPattern.firstSeen && (
                  <div>
                    First seen: {formatTimestamp(selectedPattern.firstSeen)}
                  </div>
                )}
                {selectedPattern.lastSeen && (
                  <div>
                    Last seen: {formatTimestamp(selectedPattern.lastSeen)}
                  </div>
                )}
              </div>
            )}

            {/* Story 1.19: Workflow Preview Section */}
            {selectedPattern.patternData?.steps && (
              <div className="space-y-2">
                <Button
                  onClick={() => setShowWorkflow(!showWorkflow)}
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  {showWorkflow ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-1" />
                      Hide Workflow
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-1" />
                      Preview Workflow (
                      {selectedPattern.patternData.steps.length} steps)
                    </>
                  )}
                </Button>
                {showWorkflow && (
                  <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                    <WorkflowDisplay
                      workflow={selectedPattern.patternData}
                      title="Workflow Steps"
                      collapsible={false}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Conversion form or action buttons */}
            {showConversionForm ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Automation name *"
                  value={automationName}
                  onChange={(e) => setAutomationName(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  autoFocus
                />
                <textarea
                  placeholder="Description (optional)"
                  value={automationDescription}
                  onChange={(e) => setAutomationDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-white resize-none"
                />
                <div className="flex gap-2">
                  <Button onClick={handleSaveAutomation} variant="default">
                    Save Automation
                  </Button>
                  <Button
                    onClick={() => setShowConversionForm(false)}
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button onClick={handleConvertToAutomation} variant="default">
                  Convert to Automation
                </Button>
                <Button onClick={handleDismiss} variant="secondary">
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Toast notification */}
      {showToast && (
        <Toast
          type={toastType}
          message={toastMessage}
          onClose={() => setShowToast(false)}
          duration={3000}
        />
      )}
    </>
  );
};
