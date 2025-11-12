import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager } from "./database/Database";
import Database from "better-sqlite3";

/**
 * Notification type enum
 */
export type NotificationType = "pattern" | "monitor" | "system";

/**
 * Notification severity levels
 */
export type NotificationSeverity = "info" | "warning" | "error";

/**
 * Notification interface
 */
export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  data?: string; // JSON string for additional context
  created_at: number;
  dismissed_at: number | null;
}

/**
 * Create notification input
 */
export interface CreateNotificationInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * NotificationManager - Singleton for managing notifications
 * Handles CRUD operations for the notifications system
 */
export class NotificationManager {
  private static instance: NotificationManager | null = null;
  private db: Database.Database | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  /**
   * Initialize the notification manager
   * Called once at app startup
   */
  public async initialize(): Promise<void> {
    try {
      log.info("[NotificationManager] Initializing...");

      // Get database instance
      this.db = DatabaseManager.getInstance().getDatabase();

      // Run auto-cleanup for notifications exceeding max count
      await this.autoCleanup();

      log.info("[NotificationManager] Initialized successfully");
    } catch (error) {
      log.error("[NotificationManager] Initialization failed:", error);
      throw {
        code: "NOTIF_INIT_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create a new notification
   */
  public async createNotification(
    input: CreateNotificationInput,
  ): Promise<Notification> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      // Validate input
      if (!input.type || !input.severity || !input.title || !input.message) {
        throw new Error("Missing required notification fields");
      }

      // Validate type and severity
      const validTypes: NotificationType[] = ["pattern", "monitor", "system"];
      const validSeverities: NotificationSeverity[] = [
        "info",
        "warning",
        "error",
      ];

      if (!validTypes.includes(input.type)) {
        throw new Error(`Invalid notification type: ${input.type}`);
      }

      if (!validSeverities.includes(input.severity)) {
        throw new Error(`Invalid notification severity: ${input.severity}`);
      }

      const notification: Notification = {
        id: uuidv4(),
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        data: input.data ? JSON.stringify(input.data) : undefined,
        created_at: Date.now(),
        dismissed_at: null,
      };

      const stmt = this.db.prepare(`
        INSERT INTO notifications (id, type, severity, title, message, data, created_at, dismissed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        notification.id,
        notification.type,
        notification.severity,
        notification.title,
        notification.message,
        notification.data,
        notification.created_at,
        notification.dismissed_at,
      );

      log.info("[NotificationManager] Created notification:", notification.id);

      // Check if cleanup is needed after creating notification
      await this.cleanupByType(notification.type);

      return notification;
    } catch (error) {
      log.error("[NotificationManager] Create notification failed:", error);
      throw {
        code: "NOTIF_CREATE_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get all notifications (optionally filtered by type)
   */
  public async getNotifications(
    type?: NotificationType,
  ): Promise<Notification[]> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      let stmt: Database.Statement;

      if (type) {
        stmt = this.db.prepare(`
          SELECT * FROM notifications
          WHERE type = ?
          ORDER BY created_at DESC
        `);
        const rows = stmt.all(type) as Notification[];
        return rows;
      } else {
        stmt = this.db.prepare(`
          SELECT * FROM notifications
          ORDER BY created_at DESC
        `);
        const rows = stmt.all() as Notification[];
        return rows;
      }
    } catch (error) {
      log.error("[NotificationManager] Get notifications failed:", error);
      throw {
        code: "NOTIF_FETCH_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get undismissed notifications count
   */
  public async getUnreadCount(): Promise<number> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE dismissed_at IS NULL
      `);

      const result = stmt.get() as { count: number };
      return result.count;
    } catch (error) {
      log.error("[NotificationManager] Get unread count failed:", error);
      throw {
        code: "NOTIF_FETCH_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Dismiss a notification by ID
   */
  public async dismissNotification(notificationId: string): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      if (!notificationId) {
        throw new Error("Notification ID is required");
      }

      const stmt = this.db.prepare(`
        UPDATE notifications
        SET dismissed_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(Date.now(), notificationId);

      if (result.changes === 0) {
        throw new Error(`Notification not found: ${notificationId}`);
      }

      log.info("[NotificationManager] Dismissed notification:", notificationId);
    } catch (error) {
      log.error("[NotificationManager] Dismiss notification failed:", error);
      throw {
        code: "NOTIF_DISMISS_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Dismiss all notifications
   */
  public async dismissAll(): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      const stmt = this.db.prepare(`
        UPDATE notifications
        SET dismissed_at = ?
        WHERE dismissed_at IS NULL
      `);

      const result = stmt.run(Date.now());

      log.info(
        "[NotificationManager] Dismissed all notifications, count:",
        result.changes,
      );
    } catch (error) {
      log.error(
        "[NotificationManager] Dismiss all notifications failed:",
        error,
      );
      throw {
        code: "NOTIF_DISMISS_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Auto-cleanup notifications exceeding max count per type
   * Keeps the 50 most recent notifications per type
   */
  private async autoCleanup(): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      const types: NotificationType[] = ["pattern", "monitor", "system"];

      for (const type of types) {
        await this.cleanupByType(type);
      }

      log.info("[NotificationManager] Auto-cleanup completed");
    } catch (error) {
      log.error("[NotificationManager] Auto-cleanup failed:", error);
      throw {
        code: "NOTIF_CLEANUP_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Cleanup notifications by type, keeping only the 50 most recent
   */
  private async cleanupByType(type: NotificationType): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("NotificationManager not initialized");
      }

      const MAX_NOTIFICATIONS_PER_TYPE = 50;

      // Count notifications of this type
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE type = ?
      `);

      const countResult = countStmt.get(type) as { count: number };
      const count = countResult.count;

      if (count > MAX_NOTIFICATIONS_PER_TYPE) {
        const toDelete = count - MAX_NOTIFICATIONS_PER_TYPE;

        // Delete oldest notifications
        const deleteStmt = this.db.prepare(`
          DELETE FROM notifications
          WHERE id IN (
            SELECT id FROM notifications
            WHERE type = ?
            ORDER BY created_at ASC
            LIMIT ?
          )
        `);

        const result = deleteStmt.run(type, toDelete);

        log.info(
          `[NotificationManager] Cleaned up ${result.changes} old notifications of type: ${type}`,
        );
      }
    } catch (error) {
      log.error(
        `[NotificationManager] Cleanup by type failed for ${type}:`,
        error,
      );
      // Don't throw - cleanup failures shouldn't block other operations
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    try {
      log.info("[NotificationManager] Cleaning up...");
      // Run final cleanup before shutdown
      await this.autoCleanup();
      this.db = null;
      log.info("[NotificationManager] Cleanup completed");
    } catch (error) {
      log.error("[NotificationManager] Cleanup failed:", error);
    }
  }

  /**
   * Destroy the singleton instance (for testing)
   */
  public static destroy(): void {
    NotificationManager.instance = null;
  }
}
