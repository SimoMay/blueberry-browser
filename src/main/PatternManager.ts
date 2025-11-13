import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager } from "./database/Database";
import Database from "better-sqlite3";
import {
  PatternTrackInput,
  PatternGetAllInput,
  SaveAutomationInput,
  ExecuteAutomationInput,
} from "./schemas/patternSchemas";

/**
 * Pattern type
 */
export type PatternType = "navigation" | "form" | "copy-paste";

/**
 * Pattern interface
 */
export interface Pattern {
  id: string;
  type: PatternType;
  pattern_data: string;
  confidence: number;
  created_at: number;
}

/**
 * Automation interface
 */
export interface Automation {
  id: string;
  pattern_id: string;
  name: string;
  description?: string;
  created_at: number;
}

/**
 * Navigation event data for pattern tracking
 */
export interface NavigationEvent {
  url: string;
  tabId: string;
  timestamp: number;
  eventType: "did-navigate" | "did-navigate-in-page";
}

/**
 * Navigation sequence item stored in pattern_data
 */
export interface NavigationSequenceItem {
  url: string;
  timestamp: number;
  tabId: string;
}

/**
 * Navigation pattern structure for JSON storage
 */
export interface NavigationPattern {
  sequence: NavigationSequenceItem[];
  sessionGap: number; // 30 minutes in milliseconds (1800000)
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
 * PatternManager - Singleton for managing patterns and automations
 * Handles CRUD operations for pattern detection and automation execution
 */
export class PatternManager {
  private static instance: PatternManager | null = null;
  private db: Database.Database | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PatternManager {
    if (!PatternManager.instance) {
      PatternManager.instance = new PatternManager();
    }
    return PatternManager.instance;
  }

  /**
   * Initialize the pattern manager
   * Called once at app startup
   */
  public async initialize(): Promise<void> {
    try {
      log.info("[PatternManager] Initializing...");

      // Get database instance
      this.db = DatabaseManager.getInstance().getDatabase();

      // Run cleanup on startup
      await this.cleanupOldPatterns();

      log.info("[PatternManager] Initialized successfully");
    } catch (error) {
      log.error("[PatternManager] Initialization failed:", error);
      throw {
        code: "PATTERN_INIT_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Track a new pattern
   * Database integration will be implemented in Story 1.6
   */
  public async trackPattern(
    data: PatternTrackInput,
  ): Promise<IPCResponse<Pattern>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Track pattern:", data.type);

      // Placeholder: Database integration will happen in Story 1.6
      const pattern: Pattern = {
        id: uuidv4(),
        type: data.type,
        pattern_data: data.pattern_data,
        confidence: data.confidence,
        created_at: Date.now(),
      };

      log.info("[PatternManager] Pattern tracked successfully:", pattern.id);

      return {
        success: true,
        data: pattern,
      };
    } catch (error) {
      log.error("[PatternManager] Track pattern error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get all patterns (optionally filtered)
   * Database integration will be implemented in Story 1.8
   */
  public async getAllPatterns(
    filters?: PatternGetAllInput,
  ): Promise<IPCResponse<Pattern[]>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info(
        "[PatternManager] Get all patterns, filters:",
        filters ? JSON.stringify(filters) : "none",
      );

      // Placeholder: Database query will be implemented in Story 1.8
      const patterns: Pattern[] = [];

      log.info("[PatternManager] Retrieved patterns, count:", patterns.length);

      return {
        success: true,
        data: patterns,
      };
    } catch (error) {
      log.error("[PatternManager] Get patterns error:", error);
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
   * Save an automation
   * Database integration will be implemented in Story 1.10
   */
  public async saveAutomation(
    data: SaveAutomationInput,
  ): Promise<IPCResponse<Automation>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Save automation:", data.name);

      // Placeholder: Database integration will happen in Story 1.10
      const automation: Automation = {
        id: uuidv4(),
        pattern_id: data.pattern_id,
        name: data.name,
        description: data.description,
        created_at: Date.now(),
      };

      log.info(
        "[PatternManager] Automation saved successfully:",
        automation.id,
      );

      return {
        success: true,
        data: automation,
      };
    } catch (error) {
      log.error("[PatternManager] Save automation error:", error);
      return {
        success: false,
        error: {
          code: "SAVE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Execute an automation
   * Execution logic will be implemented in Story 1.10
   */
  public async executeAutomation(
    data: ExecuteAutomationInput,
  ): Promise<IPCResponse<{ execution_result: string }>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Execute automation:", data.automation_id);

      // Placeholder: Execution logic will be implemented in Story 1.10
      const result = {
        execution_result: `Automation ${data.automation_id} execution placeholder`,
      };

      log.info(
        "[PatternManager] Automation executed successfully:",
        data.automation_id,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      log.error("[PatternManager] Execute automation error:", error);
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Track navigation event and store in pattern database
   * Groups navigations into sessions based on 30-minute gap threshold
   */
  public async trackNavigation(
    event: NavigationEvent,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

      // Find most recent navigation pattern for this tab
      const lastPatternStmt = this.db.prepare(`
        SELECT id, pattern_data, last_seen
        FROM patterns
        WHERE type = 'navigation'
        AND json_extract(pattern_data, '$.sequence[#-1].tabId') = ?
        ORDER BY last_seen DESC
        LIMIT 1
      `);

      const lastPattern = lastPatternStmt.get(event.tabId) as
        | { id: string; pattern_data: string; last_seen: number }
        | undefined;

      // Check if we should continue existing session or start new one
      const shouldStartNewSession =
        !lastPattern ||
        event.timestamp - lastPattern.last_seen > SESSION_GAP_MS;

      if (shouldStartNewSession) {
        // Create new navigation pattern session
        const patternId = uuidv4();
        const newPattern: NavigationPattern = {
          sequence: [
            {
              url: event.url,
              timestamp: event.timestamp,
              tabId: event.tabId,
            },
          ],
          sessionGap: SESSION_GAP_MS,
        };

        const insertStmt = this.db.prepare(`
          INSERT INTO patterns (
            id, type, pattern_data, confidence, occurrence_count,
            first_seen, last_seen, created_at
          ) VALUES (?, 'navigation', ?, 0, 1, ?, ?, ?)
        `);

        insertStmt.run(
          patternId,
          JSON.stringify(newPattern),
          event.timestamp,
          event.timestamp,
          event.timestamp,
        );

        log.info("[PatternManager] New navigation session started:", {
          patternId,
          url: event.url,
          tabId: event.tabId,
        });
      } else {
        // Append to existing session
        const existingPattern: NavigationPattern = JSON.parse(
          lastPattern.pattern_data,
        );
        existingPattern.sequence.push({
          url: event.url,
          timestamp: event.timestamp,
          tabId: event.tabId,
        });

        const updateStmt = this.db.prepare(`
          UPDATE patterns
          SET pattern_data = ?, last_seen = ?
          WHERE id = ?
        `);

        updateStmt.run(
          JSON.stringify(existingPattern),
          event.timestamp,
          lastPattern.id,
        );

        log.info("[PatternManager] Navigation appended to session:", {
          patternId: lastPattern.id,
          sequenceLength: existingPattern.sequence.length,
          url: event.url,
        });
      }

      // Run cleanup if needed (lightweight check)
      await this.cleanupOldPatterns();

      return { success: true };
    } catch (error) {
      log.error("[PatternManager] Track navigation error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Clean up old patterns based on retention policy
   * - Delete patterns older than 30 days
   * - Enforce max 100 patterns using FIFO deletion
   */
  public async cleanupOldPatterns(): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const RETENTION_DAYS = 30;
      const MAX_PATTERNS = 100;
      const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

      // Delete old patterns (30 days)
      const deleteOldStmt = this.db.prepare(`
        DELETE FROM patterns
        WHERE created_at < ?
      `);
      const oldResult = deleteOldStmt.run(cutoffTime);

      if (oldResult.changes > 0) {
        log.info(
          "[PatternManager] Cleanup: Deleted old patterns:",
          oldResult.changes,
        );
      }

      // Enforce max pattern limit (FIFO)
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM patterns",
      );
      const result = countStmt.get() as { count: number } | undefined;
      const count = result?.count || 0;

      if (count > MAX_PATTERNS) {
        const excessCount = count - MAX_PATTERNS;
        const deleteFifoStmt = this.db.prepare(`
          DELETE FROM patterns
          WHERE id IN (
            SELECT id FROM patterns
            ORDER BY created_at ASC
            LIMIT ?
          )
        `);
        const fifoResult = deleteFifoStmt.run(excessCount);

        log.info(
          "[PatternManager] Cleanup: FIFO deletion:",
          fifoResult.changes,
        );
      }
    } catch (error) {
      log.error("[PatternManager] Cleanup error:", error);
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    try {
      log.info("[PatternManager] Cleaning up...");
      this.db = null;
      log.info("[PatternManager] Cleanup completed");
    } catch (error) {
      log.error("[PatternManager] Cleanup failed:", error);
    }
  }

  /**
   * Destroy the singleton instance (for testing)
   */
  public static destroy(): void {
    PatternManager.instance = null;
  }
}
