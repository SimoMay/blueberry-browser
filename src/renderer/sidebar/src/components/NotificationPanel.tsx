import React, { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  X,
  AlertCircle,
  Info,
  AlertTriangle,
  TestTube,
  MessageSquare,
} from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";
import { Button } from "@common/components/Button";

interface NotificationPanelProps {
  onBackToChat?: () => void;
  onPatternClick?: (notificationId: string, patternData: unknown) => void;
}

interface Notification {
  id: string;
  type: "pattern" | "monitor" | "system";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  data?: string;
  created_at: number;
  dismissed_at: number | null;
}

/**
 * NotificationPanel component - displays notification history
 * Shows notifications grouped by type with dismiss functionality
 */
export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  onBackToChat,
  onPatternClick,
}) => {
  const {
    notifications,
    dismissNotification,
    markAllRead,
    refreshNotifications,
    loading,
  } = useNotifications();
  const [showTestPanel, setShowTestPanel] = useState(false);

  // Refresh notifications when panel becomes visible
  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  // Filter out dismissed notifications for active view
  const activeNotifications = notifications.filter(
    (n) => n.dismissed_at === null,
  );

  // Create test notification
  const createTestNotification = async (
    type: "pattern" | "monitor" | "system",
    severity: "info" | "warning" | "error",
  ): Promise<void> => {
    const titles = {
      pattern: "Pattern Detected",
      monitor: "Monitor Alert",
      system: "System Message",
    };
    const messages = {
      pattern: "A new navigation pattern was detected on example.com",
      monitor: "Content changed on monitored page",
      system: "Application updated successfully",
    };

    await window.sidebarAPI.notifications.createTest({
      type,
      severity,
      title: titles[type],
      message: messages[type],
    });
  };

  // Group notifications by read/unread status and sort by date
  const unreadNotifications = notifications
    .filter((n) => n.dismissed_at === null)
    .sort((a, b) => b.created_at - a.created_at);

  const readNotifications = notifications
    .filter((n) => n.dismissed_at !== null)
    .sort((a, b) => b.created_at - a.created_at);

  // Get severity icon
  const getSeverityIcon = (
    severity: Notification["severity"],
  ): React.ReactElement => {
    switch (severity) {
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "info":
      default:
        return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    try {
      return formatDistanceToNow(timestamp, { addSuffix: true });
    } catch {
      return "Unknown time";
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Notifications
            </h2>
          </div>
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
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          {activeNotifications.length === 0
            ? "No unread notifications"
            : `${activeNotifications.length} ${activeNotifications.length === 1 ? "notification" : "notifications"}`}
        </p>
      </div>

      {/* Action Bar */}
      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex gap-2 items-center justify-between">
          <button
            onClick={() => setShowTestPanel(!showTestPanel)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
            title="Test notifications"
          >
            <TestTube className="w-4 h-4" />
          </button>
          {activeNotifications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              className="text-xs"
            >
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {/* Test Panel */}
      {showTestPanel && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <h3 className="text-xs font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Create Test Notifications
          </h3>
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => createTestNotification("pattern", "info")}
                className="text-xs"
              >
                Pattern (Info)
              </Button>
              <Button
                size="sm"
                onClick={() => createTestNotification("monitor", "warning")}
                className="text-xs"
              >
                Monitor (Warning)
              </Button>
              <Button
                size="sm"
                onClick={() => createTestNotification("system", "error")}
                className="text-xs"
              >
                System (Error)
              </Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click buttons to create test notifications
            </p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Loading notifications...
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <Bell className="w-12 h-12 mb-4 text-gray-400 dark:text-gray-600" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No notifications yet
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            Click the <strong>Test</strong> button above to create sample
            notifications
          </p>
        </div>
      )}

      {/* Notification list */}
      {!loading && notifications.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {/* Unread Notifications */}
          {unreadNotifications.length > 0 && (
            <div className="border-b border-gray-200 dark:border-gray-700">
              {/* Unread header */}
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800">
                <h3 className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
                  Unread ({unreadNotifications.length})
                </h3>
              </div>

              {/* Unread notification items */}
              {unreadNotifications.map((notification) => {
                const isPattern = notification.type === "pattern";
                const handleNotificationClick = (): void => {
                  if (isPattern && notification.data && onPatternClick) {
                    // Parse pattern data if it's a JSON string
                    let patternData;
                    try {
                      patternData =
                        typeof notification.data === "string"
                          ? JSON.parse(notification.data)
                          : notification.data;
                    } catch (error) {
                      console.error(
                        "[NotificationPanel] Failed to parse pattern data:",
                        error,
                      );
                      patternData = notification.data;
                    }

                    // Call parent callback to handle pattern click
                    onPatternClick(notification.id, patternData);
                  }
                };

                return (
                  <div
                    key={notification.id}
                    className={`p-4 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isPattern ? "cursor-pointer" : ""}`}
                    onClick={handleNotificationClick}
                  >
                    <div className="flex items-start gap-3">
                      {/* Severity icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        {getSeverityIcon(notification.severity)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                            {notification.title}
                            {isPattern && (
                              <span className="ml-2 text-xs text-blue-500">
                                (Click to interact)
                              </span>
                            )}
                          </h4>

                          {/* Dismiss button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissNotification(notification.id);
                            }}
                            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            aria-label="Dismiss notification"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {notification.message}
                        </p>

                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                          {formatTimestamp(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Read Notifications */}
          {readNotifications.length > 0 && (
            <div className="border-b border-gray-200 dark:border-gray-700">
              {/* Read header */}
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800">
                <h3 className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
                  Read ({readNotifications.length})
                </h3>
              </div>

              {/* Read notification items */}
              {readNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-gray-100 dark:border-gray-800 opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Severity icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {getSeverityIcon(notification.severity)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                        {notification.title}
                      </h4>

                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {notification.message}
                      </p>

                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                        {formatTimestamp(notification.created_at)} • Dismissed
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
