import React, { useEffect, useState, useRef } from "react";
import { ChatProvider } from "./contexts/ChatContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { PatternProvider } from "./contexts/PatternContext";
import { Chat } from "./components/Chat";
import { NotificationPanel } from "./components/NotificationPanel";
import { useDarkMode } from "@common/hooks/useDarkMode";

interface PendingPatternData {
  notificationId: string;
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
}

const SidebarContent: React.FC = () => {
  const { isDarkMode } = useDarkMode();
  const [showNotifications, setShowNotifications] = useState(false);
  const [pendingPatternData, setPendingPatternData] =
    useState<PendingPatternData | null>(null);
  // Track processed notifications at parent level so it persists across Chat mount/unmount
  const processedNotificationIds = useRef<Set<string>>(new Set());

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
      setShowNotifications(true);
    };

    const handleShowChat = (): void => {
      setShowNotifications(false);
    };

    const handleToggleView = (): void => {
      setShowNotifications((prev) => !prev);
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
      setShowNotifications(false);
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
        patternData?: unknown;
      };

      setPendingPatternData({
        notificationId,
        patternData: {
          id: data.id,
          patternType: data.type as "navigation" | "form",
          confidence: data.confidence,
          occurrenceCount: data.occurrenceCount,
          patternData:
            data.patternData as PendingPatternData["patternData"]["patternData"],
        },
      });
      // Switch to chat view
      setShowNotifications(false);
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
      {/* Main content area - conditionally show chat or notifications */}
      <div className="flex-1 overflow-hidden">
        {showNotifications ? (
          <NotificationPanel
            onBackToChat={() => setShowNotifications(false)}
            onPatternClick={handlePatternClick}
          />
        ) : (
          <Chat
            pendingPatternData={pendingPatternData}
            onPatternProcessed={handlePatternProcessed}
            onPatternActionComplete={handlePatternActionComplete}
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
        <ChatProvider>
          <SidebarContent />
        </ChatProvider>
      </PatternProvider>
    </NotificationProvider>
  );
};
