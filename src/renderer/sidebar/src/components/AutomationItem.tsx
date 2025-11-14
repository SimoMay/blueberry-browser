import React, { useState } from "react";
import {
  Play,
  Edit2,
  Trash2,
  Navigation,
  FileText,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@common/components/Button";
import { Modal } from "@common/components/Modal";
import { Automation } from "../contexts/AutomationContext";

interface AutomationItemProps {
  automation: Automation;
  executing: boolean;
  progress: {
    currentStep: number;
    totalSteps: number;
    stepDescription: string;
  } | null;
  onExecute: (automationId: string) => void;
  onEdit: (
    automationId: string,
    name: string,
    description?: string,
  ) => Promise<void>;
  onDelete: (automationId: string) => Promise<void>;
}

/**
 * AutomationItem component - displays a single automation with actions
 */
export const AutomationItem: React.FC<AutomationItemProps> = ({
  automation,
  executing,
  progress,
  onExecute,
  onEdit,
  onDelete,
}) => {
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editName, setEditName] = useState(automation.name);
  const [editDescription, setEditDescription] = useState(
    automation.description || "",
  );
  const [submitting, setSubmitting] = useState(false);

  // Get pattern type icon
  const getPatternIcon = (): React.JSX.Element | null => {
    if (automation.patternType === "navigation") {
      return <Navigation className="h-4 w-4 text-blue-500" />;
    } else if (automation.patternType === "form") {
      return <FileText className="h-4 w-4 text-green-500" />;
    }
    return null;
  };

  // Get pattern type label
  const getPatternLabel = (): string => {
    if (automation.patternType === "navigation") {
      const sequence = automation.patternData.sequence || [];
      return `${sequence.length} pages`;
    } else if (automation.patternType === "form") {
      const fields = automation.patternData.fields || [];
      return `${fields.length} fields`;
    }
    return "Unknown";
  };

  // Handle execute confirm
  const handleExecuteConfirm = (): void => {
    setShowExecuteModal(false);
    onExecute(automation.id);
  };

  // Get step preview for execution confirmation
  const getStepPreview = (): React.JSX.Element => {
    if (automation.patternType === "navigation") {
      const sequence = automation.patternData.sequence || [];
      const preview = sequence.slice(0, 3);
      return (
        <div className="space-y-1">
          {preview.map(
            (step: { url: string; timestamp: number }, index: number) => (
              <div
                key={index}
                className="text-xs text-gray-600 dark:text-gray-400"
              >
                {index + 1}. {new URL(step.url).hostname}
                {index < preview.length - 1 && " →"}
              </div>
            ),
          )}
          {sequence.length > 3 && (
            <div className="text-xs text-gray-500 dark:text-gray-500">
              ... and {sequence.length - 3} more steps
            </div>
          )}
        </div>
      );
    } else if (automation.patternType === "form") {
      const fields = automation.patternData.fields || [];
      const domain = automation.patternData.domain || "Unknown domain";
      return (
        <div className="space-y-1">
          <div className="text-xs text-gray-600 dark:text-gray-400">
            Domain: {domain}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400">
            {fields.length} {fields.length === 1 ? "field" : "fields"} to fill
          </div>
        </div>
      );
    }
    return <></>;
  };

  // Handle edit submit
  const handleEditSubmit = async (): Promise<void> => {
    if (!editName.trim()) {
      return;
    }

    if (editName.length > 100) {
      return;
    }

    if (editDescription.length > 500) {
      return;
    }

    try {
      setSubmitting(true);
      await onEdit(
        automation.id,
        editName.trim(),
        editDescription.trim() || undefined,
      );
      setShowEditModal(false);
    } catch (error) {
      console.error("Failed to edit automation:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete confirm
  const handleDeleteConfirm = async (): Promise<void> => {
    try {
      setSubmitting(true);
      await onDelete(automation.id);
      setShowDeleteModal(false);
    } catch (error) {
      console.error("Failed to delete automation:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Format last executed time
  const formatLastExecuted = (): string => {
    if (!automation.lastExecuted) {
      return "Never executed";
    }
    return `Last run ${formatDistanceToNow(automation.lastExecuted, { addSuffix: true })}`;
  };

  return (
    <>
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:shadow-md transition-shadow">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {getPatternIcon()}
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {automation.name}
              </h3>
            </div>
            {automation.description && (
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                {automation.description}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="font-medium">{getPatternLabel()}</span>
          </span>
          <span>•</span>
          <span>
            {automation.executionCount}{" "}
            {automation.executionCount === 1 ? "run" : "runs"}
          </span>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {formatLastExecuted()}
        </div>

        {/* Progress indicator */}
        {executing && progress && (
          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                Step {progress.currentStep} of {progress.totalSteps}
              </span>
            </div>
            <div className="text-xs text-blue-600 dark:text-blue-400">
              {progress.stepDescription}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowExecuteModal(true)}
            disabled={executing}
            className="flex-1"
          >
            {executing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Execute
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditName(automation.name);
              setEditDescription(automation.description || "");
              setShowEditModal(true);
            }}
            disabled={executing}
          >
            <Edit2 className="h-3 w-3" />
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowDeleteModal(true)}
            disabled={executing}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Execute Confirmation Modal */}
      <Modal
        isOpen={showExecuteModal}
        onClose={() => !executing && setShowExecuteModal(false)}
        title="Execute Automation"
      >
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
              Execute <strong>&quot;{automation.name}&quot;</strong>?
            </p>
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                {getPatternIcon()}
                <span className="font-medium">
                  {automation.patternType === "navigation"
                    ? "Navigation Pattern"
                    : "Form Pattern"}
                </span>
              </div>
              {getStepPreview()}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowExecuteModal(false)}
              disabled={executing}
            >
              Cancel
            </Button>
            <Button onClick={handleExecuteConfirm} disabled={executing}>
              {executing ? "Executing..." : "Confirm Execute"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => !submitting && setShowEditModal(false)}
        title="Edit Automation"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="edit-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Name *
            </label>
            <input
              id="edit-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="My Automation"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {editName.length}/100 characters
            </p>
          </div>

          <div>
            <label
              htmlFor="edit-description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Description (optional)
            </label>
            <textarea
              id="edit-description"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="What does this automation do?"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {editDescription.length}/500 characters
            </p>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowEditModal(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={!editName.trim() || submitting}
            >
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => !submitting && setShowDeleteModal(false)}
        title="Delete Automation"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Delete <strong>&quot;{automation.name}&quot;</strong>? This cannot
            be undone.
          </p>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowDeleteModal(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={submitting}
            >
              {submitting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
