import React from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@common/components/Modal";
import { Button } from "@common/components/Button";

interface RecordingActiveModalProps {
  recordingTabTitle: string;
  onSwitchToTab: () => void;
  onCancel: () => void;
}

/**
 * Modal shown when user attempts to start second recording while one is already active
 * AC #7: Provides warning and options to switch to recording tab or cancel
 */
export const RecordingActiveModal: React.FC<RecordingActiveModalProps> = ({
  recordingTabTitle,
  onSwitchToTab,
  onCancel,
}) => {
  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title="Recording Already in Progress"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" onClick={onSwitchToTab}>
            Switch to Recording Tab
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Recording already in progress on{" "}
            <span className="font-medium">{recordingTabTitle}</span>.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Stop the current recording first before starting a new one.
          </p>
        </div>
      </div>
    </Modal>
  );
};
