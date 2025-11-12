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
