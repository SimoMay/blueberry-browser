import React, { useState, type JSX } from "react";
import {
  Navigation,
  Edit3,
  MousePointer,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Modal } from "@common/components/Modal";
import { Button } from "@common/components/Button";
import { Toast } from "@common/components/Toast";
import { useRecording } from "../contexts/RecordingContext";

interface RecordedAction {
  type: "navigation" | "form" | "click";
  timestamp: number;
  data: unknown;
}

interface RecordingPreviewModalProps {
  actions: unknown[];
  duration: number;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Modal for previewing recorded actions and saving as automation
 */
export const RecordingPreviewModal: React.FC<RecordingPreviewModalProps> = ({
  actions,
  duration,
  onClose,
  onSaved,
}) => {
  const { saveRecording } = useRecording();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Safely cast actions
  const recordedActions = actions as RecordedAction[];

  // Calculate estimated replay duration
  const estimateDuration = (actions: RecordedAction[]): string => {
    let totalSeconds = 0;
    actions.forEach((action) => {
      switch (action.type) {
        case "navigation":
          totalSeconds += 1.0; // 1 second per navigation
          break;
        case "form":
          totalSeconds += 0.5; // 0.5 seconds per form field
          break;
        case "click":
          totalSeconds += 0.3; // 0.3 seconds per click
          break;
      }
    });
    return totalSeconds < 60
      ? `~${Math.ceil(totalSeconds)}s`
      : `~${Math.ceil(totalSeconds / 60)}m`;
  };

  const getActionIcon = (type: string): JSX.Element | null => {
    switch (type) {
      case "navigation":
        return <Navigation className="h-4 w-4 text-blue-500" />;
      case "form":
        return <Edit3 className="h-4 w-4 text-green-500" />;
      case "click":
        return <MousePointer className="h-4 w-4 text-purple-500" />;
      default:
        return null;
    }
  };

  const getActionLabel = (action: RecordedAction): string => {
    switch (action.type) {
      case "navigation": {
        const navData = action.data as { url?: string };
        return navData.url || "Navigate";
      }
      case "form": {
        const formData = action.data as { domain?: string; fields?: unknown[] };
        return `Form on ${formData.domain || "unknown"}`;
      }
      case "click": {
        const clickData = action.data as { textContent?: string };
        return `Click: ${clickData.textContent || "Element"}`;
      }
      default:
        return "Unknown action";
    }
  };

  const handleSave = async (): Promise<void> => {
    // Validate name
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (name.length > 100) {
      setError("Name must be 100 characters or less");
      return;
    }

    if (description && description.length > 500) {
      setError("Description must be 500 characters or less");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await saveRecording(
        name.trim(),
        description.trim() || undefined,
        recordedActions,
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recording");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = (): void => {
    setShowDiscardConfirm(true);
  };

  const confirmDiscard = (): void => {
    // AC #5: Show "Recording discarded" toast
    setShowToast(true);
    onClose();
  };

  // Render discard confirmation modal
  if (showDiscardConfirm) {
    return (
      <Modal
        isOpen={true}
        onClose={() => setShowDiscardConfirm(false)}
        title="Discard Recording?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowDiscardConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDiscard}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          All captured actions will be lost. This cannot be undone.
        </p>
      </Modal>
    );
  }

  // Render main preview modal
  return (
    <>
      {/* Toast notification (AC #5) */}
      {showToast && (
        <Toast
          type="info"
          message="Recording discarded"
          onClose={() => setShowToast(false)}
          duration={3000}
        />
      )}

      <Modal
        isOpen={true}
        onClose={onClose}
        title="Preview Recording"
        className="max-w-lg"
      >
        <div className="space-y-4">
          {/* Recording summary */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Actions captured:
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {recordedActions.length}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Recording duration:
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {Math.ceil(duration)}s
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Estimated replay:
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {estimateDuration(recordedActions)}
              </span>
            </div>
          </div>

          {/* Action list preview (max 10) */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Actions
            </h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recordedActions.slice(0, 10).map((action, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm"
                >
                  {getActionIcon(action.type)}
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                    {getActionLabel(action)}
                  </span>
                </div>
              ))}
              {recordedActions.length > 10 && (
                <div className="text-xs text-gray-500 dark:text-gray-500 text-center py-1">
                  ... and {recordedActions.length - 10} more actions
                </div>
              )}
            </div>
          </div>

          {/* Save form */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor="automation-name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="automation-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily Login Flow"
                maxLength={100}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {name.length}/100 characters
              </p>
            </div>

            <div>
              <label
                htmlFor="automation-description"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                id="automation-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this automation do?"
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 resize-none"
              />
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {description.length}/500 characters
              </p>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={handleDiscard}
              disabled={isSaving}
            >
              Discard
            </Button>
            <Button
              variant="default"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
            >
              {isSaving ? "Saving..." : "Save Automation"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
