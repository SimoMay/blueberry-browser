import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager } from "./database/Database";
import Database from "better-sqlite3";
import {
  PatternTrackInput,
  PatternGetAllInput,
  SaveAutomationInput,
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
 * Form field data for pattern tracking
 */
export interface FormField {
  name: string;
  type: string;
  valuePattern:
    | "email_format"
    | "name_format"
    | "phone_format"
    | "number_format"
    | "text_format";
}

/**
 * Form submission data from renderer process
 */
export interface FormSubmissionData {
  domain: string;
  formSelector: string;
  fields: FormField[];
  timestamp: number;
  tabId: string;
}

/**
 * Form pattern structure for JSON storage
 */
export interface FormPattern {
  domain: string;
  formSelector: string;
  fields: FormField[];
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

      // Fetch pattern data to include in automation
      const patternStmt = this.db.prepare(`
        SELECT pattern_data FROM patterns WHERE id = ?
      `);
      const patternRow = patternStmt.get(data.pattern_id) as
        | { pattern_data: string }
        | undefined;

      if (!patternRow) {
        throw new Error(`Pattern not found: ${data.pattern_id}`);
      }

      // Create automation object
      const automation: Automation = {
        id: uuidv4(),
        pattern_id: data.pattern_id,
        name: data.name,
        description: data.description,
        created_at: Date.now(),
      };

      // Insert into database with pattern_data
      const stmt = this.db.prepare(`
        INSERT INTO automations (id, pattern_id, name, description, pattern_data, execution_count, last_executed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        automation.id,
        automation.pattern_id,
        automation.name,
        automation.description || null,
        patternRow.pattern_data,
        0, // execution_count starts at 0
        null, // last_executed is null initially
        automation.created_at,
      );

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
   * Dismiss a pattern to prevent future notifications
   */
  public async dismissPattern(
    patternId: string,
  ): Promise<IPCResponse<{ patternId: string }>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Dismissing pattern:", patternId);

      // Update pattern to set dismissed = 1
      const stmt = this.db.prepare(`
        UPDATE patterns
        SET dismissed = 1
        WHERE id = ?
      `);

      const result = stmt.run(patternId);

      if (result.changes === 0) {
        throw new Error("Pattern not found");
      }

      log.info("[PatternManager] Pattern dismissed successfully:", patternId);

      return {
        success: true,
        data: { patternId },
      };
    } catch (error) {
      log.error("[PatternManager] Dismiss pattern error:", error);
      return {
        success: false,
        error: {
          code: "DISMISS_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get all automations with full details including pattern data and execution stats
   */
  public async getAutomations(): Promise<
    IPCResponse<
      Array<{
        id: string;
        patternId: string;
        name: string;
        description?: string;
        patternData: NavigationPattern | FormPattern;
        patternType: string;
        executionCount: number;
        lastExecuted?: number;
        createdAt: number;
      }>
    >
  > {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Getting all automations");

      const stmt = this.db.prepare(`
        SELECT
          a.id,
          a.pattern_id as patternId,
          a.name,
          a.description,
          a.pattern_data as patternData,
          a.execution_count as executionCount,
          a.last_executed as lastExecuted,
          a.created_at as createdAt,
          p.type as patternType
        FROM automations a
        LEFT JOIN patterns p ON a.pattern_id = p.id
        ORDER BY a.created_at DESC
      `);

      const rows = stmt.all() as Array<{
        id: string;
        patternId: string;
        name: string;
        description?: string;
        patternData: string;
        patternType: string;
        executionCount: number;
        lastExecuted?: number;
        createdAt: number;
      }>;

      // Parse pattern_data JSON for each automation
      const automations = rows.map((row) => ({
        id: row.id,
        patternId: row.patternId,
        name: row.name,
        description: row.description,
        patternData: JSON.parse(row.patternData),
        patternType: row.patternType,
        executionCount: row.executionCount,
        lastExecuted: row.lastExecuted || undefined,
        createdAt: row.createdAt,
      }));

      log.info(`[PatternManager] Retrieved ${automations.length} automations`);

      return {
        success: true,
        data: automations,
      };
    } catch (error) {
      log.error("[PatternManager] Get automations error:", error);
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
   * Edit automation (update name and description)
   */
  public async editAutomation(data: {
    automationId: string;
    name: string;
    description?: string;
  }): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Editing automation:", data.automationId);

      const stmt = this.db.prepare(`
        UPDATE automations
        SET name = ?, description = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        data.name,
        data.description || null,
        data.automationId,
      );

      if (result.changes === 0) {
        throw new Error("Automation not found");
      }

      log.info("[PatternManager] Automation edited successfully");

      return {
        success: true,
      };
    } catch (error) {
      log.error("[PatternManager] Edit automation error:", error);
      return {
        success: false,
        error: {
          code: "UPDATE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Delete automation
   */
  public async deleteAutomation(
    automationId: string,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Deleting automation:", automationId);

      const stmt = this.db.prepare(`
        DELETE FROM automations WHERE id = ?
      `);

      const result = stmt.run(automationId);

      if (result.changes === 0) {
        throw new Error("Automation not found");
      }

      log.info("[PatternManager] Automation deleted successfully");

      return {
        success: true,
      };
    } catch (error) {
      log.error("[PatternManager] Delete automation error:", error);
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
   * Execute an automation using AutomationExecutor
   * Returns execution result with steps completed and duration
   */
  public async executeAutomation(
    automationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window: any, // Window instance passed from EventManager (circular dependency prevents proper typing)
    onProgress?: (step: number, total: number, description: string) => void,
  ): Promise<
    IPCResponse<{ stepsExecuted: number; duration: number; error?: string }>
  > {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Execute automation:", automationId);

      // Fetch automation from database
      const stmt = this.db.prepare(`
        SELECT
          a.id,
          a.pattern_data as patternData,
          p.type as patternType
        FROM automations a
        LEFT JOIN patterns p ON a.pattern_id = p.id
        WHERE a.id = ?
      `);

      const automation = stmt.get(automationId) as
        | {
            id: string;
            patternData: string;
            patternType: "navigation" | "form";
          }
        | undefined;

      if (!automation) {
        throw new Error("Automation not found");
      }

      // Parse pattern data
      const patternData = JSON.parse(automation.patternData);

      // Import AutomationExecutor dynamically to avoid circular dependency
      const { AutomationExecutor } = await import("./AutomationExecutor");
      const executor = new AutomationExecutor(window);

      // Execute automation
      const result = await executor.execute(
        automationId,
        automation.patternType,
        patternData,
        onProgress,
      );

      if (result.success) {
        // Update execution_count and last_executed timestamp
        const updateStmt = this.db.prepare(`
          UPDATE automations
          SET execution_count = execution_count + 1,
              last_executed = ?
          WHERE id = ?
        `);

        updateStmt.run(Date.now(), automationId);

        log.info(
          `[PatternManager] Automation executed successfully: ${automationId} (${result.stepsExecuted} steps in ${result.duration}ms)`,
        );
      } else {
        log.error(
          `[PatternManager] Automation execution failed: ${automationId}`,
          result.error,
        );
      }

      return {
        success: result.success,
        data: {
          stepsExecuted: result.stepsExecuted,
          duration: result.duration,
        },
        error: result.error
          ? {
              code: "EXECUTION_ERROR",
              message: result.error,
            }
          : undefined,
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
   * Track form submission and store in pattern database
   * Groups form submissions by domain + field names hash
   * Triggers notification when occurrence_count reaches threshold (3)
   */
  public async trackFormSubmission(
    data: FormSubmissionData,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const DETECTION_THRESHOLD = 3; // Trigger notification after 3 identical submissions

      // Generate pattern hash for matching (domain + sorted field names)
      const fieldNames = data.fields
        .map((f) => f.name)
        .sort()
        .join(",");
      const patternHash = `${data.domain}::${fieldNames}`;

      // Find existing pattern with same domain and field names
      const existingPatternStmt = this.db.prepare(`
        SELECT id, pattern_data, occurrence_count, confidence
        FROM patterns
        WHERE type = 'form'
        AND json_extract(pattern_data, '$.domain') = ?
        ORDER BY last_seen DESC
      `);

      const existingPatterns = existingPatternStmt.all(data.domain) as Array<{
        id: string;
        pattern_data: string;
        occurrence_count: number;
        confidence: number;
      }>;

      // Find matching pattern by comparing field names
      let matchingPattern: (typeof existingPatterns)[0] | undefined;
      for (const pattern of existingPatterns) {
        const patternData: FormPattern = JSON.parse(pattern.pattern_data);
        const existingFieldNames = patternData.fields
          .map((f) => f.name)
          .sort()
          .join(",");

        if (
          existingFieldNames === fieldNames &&
          patternData.formSelector === data.formSelector
        ) {
          matchingPattern = pattern;
          break;
        }
      }

      if (matchingPattern) {
        // Increment occurrence count for existing pattern
        const newOccurrenceCount = matchingPattern.occurrence_count + 1;
        const newConfidence = Math.min(newOccurrenceCount * 20, 100); // Max 100%

        const updateStmt = this.db.prepare(`
          UPDATE patterns
          SET occurrence_count = ?,
              confidence = ?,
              last_seen = ?
          WHERE id = ?
        `);

        updateStmt.run(
          newOccurrenceCount,
          newConfidence,
          data.timestamp,
          matchingPattern.id,
        );

        log.info("[PatternManager] Form pattern occurrence incremented:", {
          patternId: matchingPattern.id,
          domain: data.domain,
          occurrenceCount: newOccurrenceCount,
          confidence: newConfidence,
        });

        // Trigger notification if threshold reached
        if (newOccurrenceCount === DETECTION_THRESHOLD) {
          log.info(
            "[PatternManager] Form pattern threshold reached - notification triggered",
            {
              patternId: matchingPattern.id,
              domain: data.domain,
              formSelector: data.formSelector,
              fieldCount: data.fields.length,
            },
          );
          // TODO: Trigger notification system (Story 1.9)
        }
      } else {
        // Create new form pattern
        const patternId = `form-${patternHash}-${Date.now()}`;
        const formPattern: FormPattern = {
          domain: data.domain,
          formSelector: data.formSelector,
          fields: data.fields,
        };

        const insertStmt = this.db.prepare(`
          INSERT INTO patterns (
            id, type, pattern_data, confidence, occurrence_count,
            first_seen, last_seen, created_at
          ) VALUES (?, 'form', ?, 0, 1, ?, ?, ?)
        `);

        insertStmt.run(
          patternId,
          JSON.stringify(formPattern),
          data.timestamp,
          data.timestamp,
          data.timestamp,
        );

        log.info("[PatternManager] New form pattern created:", {
          patternId,
          domain: data.domain,
          formSelector: data.formSelector,
          fieldCount: data.fields.length,
        });
      }

      // Run cleanup if needed
      await this.cleanupOldPatterns();

      return { success: true };
    } catch (error) {
      log.error("[PatternManager] Track form submission error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_FORM_ERROR",
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
