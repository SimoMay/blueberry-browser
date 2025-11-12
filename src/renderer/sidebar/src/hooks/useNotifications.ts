import { useContext } from "react";
import {
  NotificationContext,
  NotificationContextType,
} from "../contexts/notificationTypes";

/**
 * Custom hook to use notification context
 * Provides access to notification state and operations
 * Must be used within a NotificationProvider
 */
export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider",
    );
  }

  return context;
};
