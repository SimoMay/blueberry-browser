import React, { useEffect, useState } from "react";
import { MessageSquare, Zap, Loader2, Video, StopCircle } from "lucide-react";
import { useAutomation } from "../contexts/AutomationContext";
import { useRecording } from "../contexts/RecordingContext";
import { AutomationItem } from "./AutomationItem";
import { Button } from "@common/components/Button";
import { RecordingPreviewModal } from "./RecordingPreviewModal";
import { ZeroActionModal } from "./ZeroActionModal";
import { RecordingActiveModal } from "./RecordingActiveModal";

interface AutomationLibraryProps {
  onBackToChat?: () => void;
}

/**
 * AutomationLibrary component - displays all saved automations
 */
export const AutomationLibrary: React.FC<AutomationLibraryProps> = ({
  onBackToChat,
}) => {
  const {
    automations,
    loading,
    executing,
    progress,
    loadAutomations,
    executeAutomation,
    editAutomation,
    deleteAutomation,
  } = useAutomation();

  const { recording, startRecording, stopRecording } = useRecording();

  const [previewData, setPreviewData] = useState<{
    actions: unknown[];
    tabId: string;
    duration: number;
  } | null>(null);
  const [isRecordingLoading, setIsRecordingLoading] = useState(false);
  const [showZeroActionModal, setShowZeroActionModal] = useState(false);
  const [recordingActiveError, setRecordingActiveError] = useState<{
    tabId: string;
    tabTitle: string;
  } | null>(null);
  const [currentTabId, setCurrentTabId] = useState<string | null>(null);

  // Refresh automations when component mounts/becomes visible
  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  // Track current active tab to determine button state
  useEffect(() => {
    const updateActiveTab = async (): Promise<void> => {
      const tabInfo = await window.sidebarAPI.getActiveTabInfo();
      setCurrentTabId(tabInfo?.id || null);
    };

    // Initial fetch
    updateActiveTab();

    // Update periodically (tab switches)
    const interval = setInterval(updateActiveTab, 500);

    return () => clearInterval(interval);
  }, []);

  const handleRecordClick = async (): Promise<void> => {
    // Check if we're on the actual recording tab (not just if recording is globally active)
    const isOnRecordingTab =
      recording.isRecording && currentTabId === recording.tabId;

    if (isOnRecordingTab) {
      // We're on the recording tab - stop recording
      // AC #9: Check action count BEFORE stopping
      setIsRecordingLoading(true);
      try {
        const countResult = await window.sidebarAPI.recording.getActionCount();
        if (countResult.success && countResult.count === 0) {
          // Show zero-action modal WITHOUT stopping recording
          setShowZeroActionModal(true);
          setIsRecordingLoading(false);
          return;
        }

        // Has actions - proceed to stop recording
        const result = await stopRecording();
        if (result) {
          setPreviewData(result);
        }
      } catch (error) {
        console.error("[AutomationLibrary] Stop recording error:", error);
      } finally {
        setIsRecordingLoading(false);
      }
    } else {
      // Start recording on active tab (may trigger warning if recording active elsewhere)
      setIsRecordingLoading(true);
      try {
        // Get active tab info
        const tabInfo = await window.sidebarAPI.getActiveTabInfo();
        if (tabInfo) {
          await startRecording(tabInfo.id);
        }
      } catch (error: unknown) {
        // AC #7: Check for RECORDING_ACTIVE error
        if (
          error &&
          typeof error === "object" &&
          "error" in error &&
          error.error &&
          typeof error.error === "object" &&
          "code" in error.error &&
          error.error.code === "RECORDING_ACTIVE" &&
          "tabId" in error.error &&
          "tabTitle" in error.error
        ) {
          setRecordingActiveError({
            tabId: error.error.tabId as string,
            tabTitle: error.error.tabTitle as string,
          });
        } else {
          console.error("[AutomationLibrary] Start recording error:", error);
        }
      } finally {
        setIsRecordingLoading(false);
      }
    }
  };

  const handlePreviewClose = (): void => {
    setPreviewData(null);
  };

  const handlePreviewSaved = (): void => {
    // Refresh automation list after saving
    loadAutomations();
  };

  const handleZeroActionContinue = (): void => {
    // AC #9: Continue recording - close modal and keep recording active
    setShowZeroActionModal(false);
  };

  const handleZeroActionCancel = async (): Promise<void> => {
    // AC #9: Cancel - stop recording and clear state
    setShowZeroActionModal(false);
    try {
      await stopRecording();
    } catch (error) {
      console.error("[AutomationLibrary] Cancel recording error:", error);
    }
  };

  const handleSwitchToRecordingTab = async (): Promise<void> => {
    // AC #7: Switch to the tab with active recording
    if (recordingActiveError) {
      try {
        await window.sidebarAPI.switchTab(recordingActiveError.tabId);
        setRecordingActiveError(null);
      } catch (error) {
        console.error("[AutomationLibrary] Switch tab error:", error);
      }
    }
  };

  const handleRecordingActiveCancel = (): void => {
    // AC #7: Cancel - just close the modal
    setRecordingActiveError(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Automation Library
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={
                recording.isRecording && currentTabId === recording.tabId
                  ? "destructive"
                  : "default"
              }
              size="sm"
              onClick={handleRecordClick}
              disabled={isRecordingLoading}
              className={`flex items-center gap-1 ${recording.isRecording && currentTabId === recording.tabId ? "animate-pulse" : ""}`}
              title={
                recording.isRecording && currentTabId === recording.tabId
                  ? `Stop recording (${recording.actionCount} actions captured)`
                  : "Start recording automation"
              }
            >
              {isRecordingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : recording.isRecording && currentTabId === recording.tabId ? (
                <StopCircle className="h-4 w-4" />
              ) : (
                <Video className="h-4 w-4" />
              )}
              {recording.isRecording && currentTabId === recording.tabId
                ? `Stop (${recording.actionCount})`
                : "Record"}
            </Button>
            {onBackToChat && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onBackToChat}
                className="flex items-center gap-1"
              >
                <MessageSquare className="h-4 w-4" />
                Chat
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          {automations.length === 0
            ? "No automations saved yet"
            : `${automations.length} ${automations.length === 1 ? "automation" : "automations"}`}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p className="text-sm">Loading automations...</p>
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-4 mb-4">
              <Zap className="h-8 w-8 text-gray-400 dark:text-gray-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              No Automations Yet
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 max-w-xs mb-4">
              Browse the web to detect patterns, then save them as automations
              to replay later.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Patterns appear in notifications when detected.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((automation) => (
              <AutomationItem
                key={automation.id}
                automation={automation}
                executing={executing.has(automation.id)}
                progress={progress.get(automation.id) || null}
                onExecute={executeAutomation}
                onEdit={editAutomation}
                onDelete={deleteAutomation}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recording Preview Modal */}
      {previewData && (
        <RecordingPreviewModal
          actions={previewData.actions}
          duration={previewData.duration}
          onClose={handlePreviewClose}
          onSaved={handlePreviewSaved}
        />
      )}

      {/* Zero Action Modal (AC #9) */}
      {showZeroActionModal && (
        <ZeroActionModal
          onContinue={handleZeroActionContinue}
          onCancel={handleZeroActionCancel}
        />
      )}

      {/* Recording Active Modal (AC #7) */}
      {recordingActiveError && (
        <RecordingActiveModal
          recordingTabTitle={recordingActiveError.tabTitle}
          onSwitchToTab={handleSwitchToRecordingTab}
          onCancel={handleRecordingActiveCancel}
        />
      )}
    </div>
  );
};
