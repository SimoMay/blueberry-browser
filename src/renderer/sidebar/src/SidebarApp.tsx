import React, { useEffect, useState, useRef } from "react";
import { ChatProvider } from "./contexts/ChatContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { PatternProvider } from "./contexts/PatternContext";
import {
  AutomationProvider,
  useAutomation,
} from "./contexts/AutomationContext";
import { RecordingProvider } from "./contexts/RecordingContext";
import { Chat } from "./components/Chat";
import { NotificationPanel } from "./components/NotificationPanel";
import { AutomationLibrary } from "./components/AutomationLibrary";
import { useDarkMode } from "@common/hooks/useDarkMode";
import { Loader2 } from "lucide-react";

interface PendingPatternData {
  notificationId: string;
  patternData: {
    id: string;
    patternType: "navigation" | "form" | "copy-paste";
    confidence: number;
    occurrenceCount: number;
    intentSummary?: string; // Story 1.13 - SHORT summary (20-30 words)
    intentSummaryDetailed?: string; // Story 1.13 - DETAILED summary (40-50 words)
    patternData?: {
      sequence?: Array<{ url: string }>;
      domain?: string;
      fields?: Array<unknown>;
    };
  };
}

type ViewMode = "chat" | "notifications" | "automations";

const SidebarContent: React.FC = () => {
  const { isDarkMode } = useDarkMode();
  const { executing, progress, automations } = useAutomation();
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [pendingPatternData, setPendingPatternData] =
    useState<PendingPatternData | null>(null);
  // Track processed notifications at parent level so it persists across Chat mount/unmount
  const processedNotificationIds = useRef<Set<string>>(new Set());

  // Get executing automations with progress
  const executingWithProgress = Array.from(executing)
    .map((id) => {
      const automation = automations.find((a) => a.id === id);
      const progressData = progress.get(id);
      return automation && progressData
        ? { automation, progress: progressData }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Apply dark mode class to the document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Listen for notification panel events
  useEffect(() => {
    const handleShowPanel = (): void => {
      setViewMode("notifications");
    };

    const handleShowChat = (): void => {
      setViewMode("chat");
    };

    const handleToggleView = (): void => {
      setViewMode((prev) => (prev === "chat" ? "notifications" : "chat"));
    };

    window.sidebarAPI.notifications.onShowPanel(handleShowPanel);
    window.sidebarAPI.notifications.onShowChat(handleShowChat);
    window.sidebarAPI.notifications.onToggleView(handleToggleView);

    return () => {
      window.sidebarAPI.notifications.removeShowPanelListener();
      window.sidebarAPI.notifications.removeShowChatListener();
      window.sidebarAPI.notifications.removeToggleViewListener();
    };
  }, []);

  const handlePatternClick = (
    notificationId: string,
    patternData: unknown,
  ): void => {
    // Check if already processed at parent level
    if (processedNotificationIds.current.has(notificationId)) {
      setViewMode("chat");
      return;
    }

    // Type guard and conversion for pattern data
    // Note: Data structure from PatternRecognizer has: id, type, confidence, occurrenceCount, patternData
    if (
      patternData &&
      typeof patternData === "object" &&
      "id" in patternData &&
      "type" in patternData &&
      "confidence" in patternData &&
      "occurrenceCount" in patternData
    ) {
      // DON'T mark as processed immediately - only mark when user takes a permanent action
      // This allows "Not Now" to dismiss the message without preventing re-opening

      // Map the data structure from PatternRecognizer to our PendingPatternData format
      const data = patternData as {
        id: string;
        type: string;
        confidence: number;
        occurrenceCount: number;
        intentSummary?: string; // Story 1.13
        intentSummaryDetailed?: string; // Story 1.13
        patternData?: unknown;
      };

      setPendingPatternData({
        notificationId,
        patternData: {
          id: data.id,
          patternType: data.type as "navigation" | "form" | "copy-paste",
          confidence: data.confidence,
          occurrenceCount: data.occurrenceCount,
          intentSummary: data.intentSummary, // Story 1.13 - pass through intent summaries
          intentSummaryDetailed: data.intentSummaryDetailed, // Story 1.13
          patternData:
            data.patternData as PendingPatternData["patternData"]["patternData"],
        },
      });
      // Switch to chat view
      setViewMode("chat");
    }
  };

  const handlePatternProcessed = (): void => {
    // Clear pending pattern data after Chat processes it
    setPendingPatternData(null);
  };

  const handlePatternActionComplete = (notificationId: string): void => {
    // Mark notification as processed when user takes a permanent action (Convert or Dismiss Pattern)
    processedNotificationIds.current.add(notificationId);
  };

  return (
    <div className="h-screen flex flex-col bg-background border-l border-border">
      {/* Compact automation progress indicators - visible across all views */}
      {executingWithProgress.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          {executingWithProgress.map(
            ({ automation, progress: progressData }) => (
              <div
                key={automation.id}
                className="px-4 py-2 border-b border-blue-100 dark:border-blue-800/50 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate">
                        Running: {automation.name}
                      </span>
                      <span className="text-xs text-blue-600 dark:text-blue-400 flex-shrink-0">
                        {progressData.currentStep}/{progressData.totalSteps}
                      </span>
                    </div>
                    <div className="w-full bg-blue-100 dark:bg-blue-900/40 rounded-full h-1">
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-1 rounded-full transition-all duration-300"
                        style={{
                          width: `${(progressData.currentStep / progressData.totalSteps) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* Main content area - conditionally show chat, notifications, or automations */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "notifications" ? (
          <NotificationPanel
            onBackToChat={() => setViewMode("chat")}
            onPatternClick={handlePatternClick}
          />
        ) : viewMode === "automations" ? (
          <AutomationLibrary onBackToChat={() => setViewMode("chat")} />
        ) : (
          <Chat
            pendingPatternData={pendingPatternData}
            onPatternProcessed={handlePatternProcessed}
            onPatternActionComplete={handlePatternActionComplete}
            onShowAutomations={() => setViewMode("automations")}
          />
        )}
      </div>
    </div>
  );
};

export const SidebarApp: React.FC = () => {
  return (
    <NotificationProvider>
      <PatternProvider>
        <AutomationProvider>
          <RecordingProvider>
            <ChatProvider>
              <SidebarContent />
            </ChatProvider>
          </RecordingProvider>
        </AutomationProvider>
      </PatternProvider>
    </NotificationProvider>
  );
};
