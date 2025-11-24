import log from "electron-log";
import { DatabaseManager } from "./database/Database";
import Database from "better-sqlite3";
import {
  MonitorCreateInput,
  MonitorGetAllInput,
  MonitorFrequency,
  MonitorStatus,
} from "./schemas/monitorSchemas";
import { type MonitorId, createMonitorId } from "./types/brandedTypes";

/**
 * Monitor interface
 */
export interface Monitor {
  id: MonitorId;
  url: string;
  goal?: string;
  frequency: MonitorFrequency;
  status: MonitorStatus;
  last_check?: number;
  created_at: number;
  updated_at: number;
}

/**
 * Standard IPC response format
 */
interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * MonitorManager - Singleton for managing page monitors
 * Handles CRUD operations for monitor configurations with database persistence
 */
export class MonitorManager {
  private static instance: MonitorManager | null = null;
  private db: Database.Database | null = null;
  private readonly MAX_MONITORS = 10;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MonitorManager {
    if (!MonitorManager.instance) {
      MonitorManager.instance = new MonitorManager();
    }
    return MonitorManager.instance;
  }

  /**
   * Initialize the monitor manager
   * Called once at app startup
   */
  public async initialize(): Promise<void> {
    try {
      log.info("[MonitorManager] Initializing...");

      // Get database instance
      this.db = DatabaseManager.getInstance().getDatabase();

      log.info("[MonitorManager] Initialized successfully");
    } catch (error) {
      log.error("[MonitorManager] Initialization failed:", error);
      throw {
        code: "MONITOR_INIT_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create a new monitor
   * Enforces max 10 concurrent monitors limit
   */
  public async createMonitor(
    data: MonitorCreateInput,
  ): Promise<IPCResponse<Monitor>> {
    try {
      if (!this.db) {
        throw new Error("MonitorManager not initialized");
      }

      log.info("[MonitorManager] Create monitor:", data.url);

      // Check monitor count limit (exclude errored monitors)
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM monitors WHERE status != 'error'",
      );
      const { count } = countStmt.get() as { count: number };

      if (count >= this.MAX_MONITORS) {
        log.warn(
          `[MonitorManager] Monitor limit reached: ${count}/${this.MAX_MONITORS}`,
        );
        return {
          success: false,
          error: {
            code: "LIMIT_EXCEEDED",
            message: `Maximum ${this.MAX_MONITORS} monitors allowed`,
          },
        };
      }

      // Generate unique ID
      const id = createMonitorId(
        `monitor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      );
      const now = Date.now();

      // Insert monitor into database
      const stmt = this.db.prepare(`
        INSERT INTO monitors (id, url, goal, frequency, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `);

      stmt.run(id, data.url, data.goal || null, data.frequency, now, now);

      const monitor: Monitor = {
        id,
        url: data.url,
        goal: data.goal,
        frequency: data.frequency,
        status: "active",
        created_at: now,
        updated_at: now,
      };

      log.info("[MonitorManager] Monitor created successfully:", id);

      return {
        success: true,
        data: monitor,
      };
    } catch (error) {
      log.error("[MonitorManager] Create monitor error:", error);
      return {
        success: false,
        error: {
          code: "CREATE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Pause a monitor
   */
  public async pauseMonitor(id: string): Promise<IPCResponse<Monitor>> {
    try {
      if (!this.db) {
        throw new Error("MonitorManager not initialized");
      }

      log.info("[MonitorManager] Pause monitor:", id);

      // Update monitor status to paused
      const updateStmt = this.db.prepare(`
        UPDATE monitors SET status = 'paused', updated_at = ? WHERE id = ?
      `);

      const result = updateStmt.run(Date.now(), id);

      if (result.changes === 0) {
        log.warn("[MonitorManager] Monitor not found:", id);
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Monitor not found",
          },
        };
      }

      // Retrieve updated monitor
      const selectStmt = this.db.prepare("SELECT * FROM monitors WHERE id = ?");
      const row = selectStmt.get(id) as {
        id: string;
        url: string;
        goal?: string;
        frequency: string;
        status: string;
        last_check?: number;
        created_at: number;
        updated_at: number;
      };
      const monitor: Monitor = {
        ...row,
        id: createMonitorId(row.id),
        frequency: row.frequency as MonitorFrequency,
        status: row.status as MonitorStatus,
      };

      log.info("[MonitorManager] Monitor paused successfully:", id);

      return {
        success: true,
        data: monitor,
      };
    } catch (error) {
      log.error("[MonitorManager] Pause monitor error:", error);
      return {
        success: false,
        error: {
          code: "PAUSE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Resume a monitor
   */
  public async resumeMonitor(id: string): Promise<IPCResponse<Monitor>> {
    try {
      if (!this.db) {
        throw new Error("MonitorManager not initialized");
      }

      log.info("[MonitorManager] Resume monitor:", id);

      // Update monitor status to active
      const updateStmt = this.db.prepare(`
        UPDATE monitors SET status = 'active', updated_at = ? WHERE id = ?
      `);

      const result = updateStmt.run(Date.now(), id);

      if (result.changes === 0) {
        log.warn("[MonitorManager] Monitor not found:", id);
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Monitor not found",
          },
        };
      }

      // Retrieve updated monitor
      const selectStmt = this.db.prepare("SELECT * FROM monitors WHERE id = ?");
      const row = selectStmt.get(id) as {
        id: string;
        url: string;
        goal?: string;
        frequency: string;
        status: string;
        last_check?: number;
        created_at: number;
        updated_at: number;
      };
      const monitor: Monitor = {
        ...row,
        id: createMonitorId(row.id),
        frequency: row.frequency as MonitorFrequency,
        status: row.status as MonitorStatus,
      };

      log.info("[MonitorManager] Monitor resumed successfully:", id);

      return {
        success: true,
        data: monitor,
      };
    } catch (error) {
      log.error("[MonitorManager] Resume monitor error:", error);
      return {
        success: false,
        error: {
          code: "RESUME_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Delete a monitor
   */
  public async deleteMonitor(id: string): Promise<IPCResponse<{ id: string }>> {
    try {
      if (!this.db) {
        throw new Error("MonitorManager not initialized");
      }

      log.info("[MonitorManager] Delete monitor:", id);

      // Delete monitor from database
      const stmt = this.db.prepare("DELETE FROM monitors WHERE id = ?");
      const result = stmt.run(id);

      if (result.changes === 0) {
        log.warn("[MonitorManager] Monitor not found:", id);
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Monitor not found",
          },
        };
      }

      log.info("[MonitorManager] Monitor deleted successfully:", id);

      return {
        success: true,
        data: { id },
      };
    } catch (error) {
      log.error("[MonitorManager] Delete monitor error:", error);
      return {
        success: false,
        error: {
          code: "DELETE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get all monitors (optionally filtered by status)
   */
  public async getAllMonitors(
    filters?: MonitorGetAllInput,
  ): Promise<IPCResponse<Monitor[]>> {
    try {
      if (!this.db) {
        throw new Error("MonitorManager not initialized");
      }

      log.info(
        "[MonitorManager] Get all monitors, filters:",
        filters ? JSON.stringify(filters) : "none",
      );

      // Build query with optional status filter
      let query = "SELECT * FROM monitors";
      const params: string[] = [];

      if (filters?.status) {
        query += " WHERE status = ?";
        params.push(filters.status);
      }

      query += " ORDER BY created_at DESC";

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as Array<{
        id: string;
        url: string;
        goal?: string;
        frequency: string;
        status: string;
        last_check?: number;
        created_at: number;
        updated_at: number;
      }>;

      // Convert DB rows to Monitor interface with branded MonitorId
      const monitors: Monitor[] = rows.map((row) => ({
        ...row,
        id: createMonitorId(row.id),
        frequency: row.frequency as MonitorFrequency,
        status: row.status as MonitorStatus,
      }));

      log.info("[MonitorManager] Retrieved monitors, count:", monitors.length);

      return {
        success: true,
        data: monitors,
      };
    } catch (error) {
      log.error("[MonitorManager] Get monitors error:", error);
      return {
        success: false,
        error: {
          code: "QUERY_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    try {
      log.info("[MonitorManager] Cleaning up...");
      this.db = null;
      log.info("[MonitorManager] Cleanup completed");
    } catch (error) {
      log.error("[MonitorManager] Cleanup failed:", error);
    }
  }

  /**
   * Destroy the singleton instance (for testing)
   */
  public static destroy(): void {
    MonitorManager.instance = null;
  }
}
