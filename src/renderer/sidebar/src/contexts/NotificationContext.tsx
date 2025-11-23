import React, {
  useState,
  useEffect,
  useCallback,
  ReactNode,
  useMemo,
} from "react";
import {
  Notification,
  NotificationContext,
  NotificationContextType,
} from "./notificationTypes";

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  /**
   * Refresh notifications from the database
   */
  const refreshNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await window.sidebarAPI.notifications.getAll();

      if (response.success && response.data) {
        setNotifications(response.data);

        // Calculate unread count (notifications without dismissed_at)
        const unread = response.data.filter((n) => n.dismissed_at === null);
        setUnreadCount(unread.length);
      }
    } catch (error) {
      console.error(
        "[NotificationContext] Failed to refresh notifications:",
        error,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Dismiss a notification by ID
   */
  const dismissNotification = useCallback(async (id: string) => {
    try {
      const response = await window.sidebarAPI.notifications.dismiss(id);

      if (response.success) {
        // Update local state
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, dismissed_at: Date.now() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } else {
        console.error(
          "[NotificationContext] Failed to dismiss notification:",
          response.error,
        );
      }
    } catch (error) {
      console.error(
        "[NotificationContext] Error dismissing notification:",
        error,
      );
    }
  }, []);

  /**
   * Mark all notifications as read
   */
  const markAllRead = useCallback(async () => {
    try {
      const response = await window.sidebarAPI.notifications.dismissAll();

      if (response.success) {
        // Update local state
        const now = Date.now();
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, dismissed_at: now })),
        );
        setUnreadCount(0);
      } else {
        console.error(
          "[NotificationContext] Failed to dismiss all notifications:",
          response.error,
        );
      }
    } catch (error) {
      console.error(
        "[NotificationContext] Error dismissing all notifications:",
        error,
      );
    }
  }, []);

  /**
   * Handle real-time notifications from main process
   */
  useEffect(() => {
    const handleNotification = (notification: Notification): void => {
      // Add to notifications list
      setNotifications((prev) => [notification, ...prev]);

      // Increment unread count if not dismissed
      if (notification.dismissed_at === null) {
        setUnreadCount((prev) => prev + 1);
      }
    };

    // Subscribe to notification events
    window.sidebarAPI.notifications.onReceive(handleNotification);

    // Initial load
    refreshNotifications();

    // Cleanup listener on unmount
    return () => {
      window.sidebarAPI.notifications.removeReceiveListener();
    };
  }, [refreshNotifications]);

  // Memoize context value to prevent unnecessary re-renders (AC-7)
  const value: NotificationContextType = useMemo(
    () => ({
      notifications,
      unreadCount,
      dismissNotification,
      markAllRead,
      refreshNotifications,
      loading,
    }),
    [
      notifications,
      unreadCount,
      dismissNotification,
      markAllRead,
      refreshNotifications,
      loading,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
