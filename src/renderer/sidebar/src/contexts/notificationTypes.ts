import { createContext } from "react";

export interface Notification {
  id: string;
  type: "pattern" | "monitor" | "system";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  data?: string;
  created_at: number;
  dismissed_at: number | null;
}

export interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  dismissNotification: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  loading: boolean;
}

export const NotificationContext = createContext<
  NotificationContextType | undefined
>(undefined);
