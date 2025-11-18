import React from "react";
import { AlertCircle } from "lucide-react";
import { Modal } from "@common/components/Modal";
import { Button } from "@common/components/Button";

interface ZeroActionModalProps {
  onContinue: () => void;
  onCancel: () => void;
}

/**
 * Modal shown when user stops recording with 0 actions captured
 * AC #9: Provides guidance and options to continue or cancel recording
 */
export const ZeroActionModal: React.FC<ZeroActionModalProps> = ({
  onContinue,
  onCancel,
}) => {
  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title="No Actions Recorded"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" onClick={onContinue}>
            Continue Recording
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            No actions recorded. To create an automation, try:
          </p>
          <ul className="text-sm text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1">
            <li>Navigate to different pages</li>
            <li>Fill out forms</li>
            <li>Click elements on the page</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
};
