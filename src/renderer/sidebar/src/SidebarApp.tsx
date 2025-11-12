import React, { useEffect, useState } from "react";
import { ChatProvider } from "./contexts/ChatContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { Chat } from "./components/Chat";
import { NotificationPanel } from "./components/NotificationPanel";
import { useDarkMode } from "@common/hooks/useDarkMode";

const SidebarContent: React.FC = () => {
  const { isDarkMode } = useDarkMode();
  const [showNotifications, setShowNotifications] = useState(false);

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

  return (
    <div className="h-screen flex flex-col bg-background border-l border-border">
      {/* Main content area - conditionally show chat or notifications */}
      <div className="flex-1 overflow-hidden">
        {showNotifications ? (
          <NotificationPanel onBackToChat={() => setShowNotifications(false)} />
        ) : (
          <Chat />
        )}
      </div>
    </div>
  );
};

export const SidebarApp: React.FC = () => {
  return (
    <NotificationProvider>
      <ChatProvider>
        <SidebarContent />
      </ChatProvider>
    </NotificationProvider>
  );
};
