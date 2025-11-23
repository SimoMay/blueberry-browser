import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import log from "electron-log";

/**
 * Migration definition for database schema versioning
 */
export interface Migration {
  version: number;
  up: string; // SQL for upgrade
  down: string; // SQL for rollback
}

/**
 * Database manager with encryption, migrations, and cleanup utilities
 *
 * Architecture decisions:
 * - Uses better-sqlite3 for ACID transactions and synchronous API
 * - Singleton pattern for single connection throughout app lifecycle
 * - WAL mode enabled for concurrent reads
 * - AES-256 encryption wrapper (custom implementation)
 * - Migration system for schema versioning
 * - Cleanup utilities for maintenance
 */
export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly encryptionKeyPath: string;
  private encryptionKey: Buffer | null = null;

  /**
   * Private constructor for singleton pattern
   * Never hardcode paths - always use app.getPath('userData')
   */
  private constructor() {
    const userDataPath = app.getPath("userData");
    this.dbPath = path.join(userDataPath, "blueberry-data.db");
    this.encryptionKeyPath = path.join(userDataPath, ".encryption-key");

    log.info("[Database] Database path:", this.dbPath);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Initialize database connection with encryption and migrations
   */
  public async initialize(): Promise<void> {
    try {
      log.info("[Database] Initializing database...");

      // Load or generate encryption key
      this.loadOrGenerateEncryptionKey();

      // Create database connection
      // Note: verbose SQL logging disabled to reduce log noise
      // To enable for debugging, add: verbose: (message) => log.debug("[Database SQL]", message)
      this.db = new Database(this.dbPath);

      // Enable WAL mode for concurrent reads
      this.db.pragma("journal_mode = WAL");
      log.info("[Database] WAL mode enabled");

      // Run migrations
      this.runMigrations();

      log.info("[Database] Database initialized successfully");
    } catch (error) {
      log.error("[Database] Initialization failed:", error);
      throw {
        code: "DB_INIT_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Load or generate AES-256 encryption key
   * Key is stored in userData directory (never committed to git)
   */
  private loadOrGenerateEncryptionKey(): void {
    try {
      if (fs.existsSync(this.encryptionKeyPath)) {
        // Load existing key
        this.encryptionKey = fs.readFileSync(this.encryptionKeyPath);
        log.info("[Database] Loaded existing encryption key");
      } else {
        // Generate new key (32 bytes = 256 bits)
        this.encryptionKey = crypto.randomBytes(32);
        fs.writeFileSync(this.encryptionKeyPath, this.encryptionKey, {
          mode: 0o600,
        });
        log.info("[Database] Generated new encryption key");
      }
    } catch (error) {
      log.error("[Database] Encryption key handling failed:", error);
      throw {
        code: "DB_ENCRYPTION_ERROR",
        message:
          error instanceof Error ? error.message : "Encryption key error",
      };
    }
  }

  /**
   * Encrypt sensitive data before storage
   */
  public encrypt(data: string): string {
    if (!this.encryptionKey) {
      throw {
        code: "DB_ENCRYPTION_ERROR",
        message: "Encryption key not loaded",
      };
    }

    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        this.encryptionKey,
        iv,
      );
      let encrypted = cipher.update(data, "utf8", "hex");
      encrypted += cipher.final("hex");

      // Prepend IV to encrypted data (needed for decryption)
      return iv.toString("hex") + ":" + encrypted;
    } catch (error) {
      log.error("[Database] Encryption failed:", error);
      throw {
        code: "DB_ENCRYPTION_ERROR",
        message: error instanceof Error ? error.message : "Encryption failed",
      };
    }
  }

  /**
   * Decrypt sensitive data after retrieval
   */
  public decrypt(encryptedData: string): string {
    if (!this.encryptionKey) {
      throw {
        code: "DB_ENCRYPTION_ERROR",
        message: "Encryption key not loaded",
      };
    }

    try {
      const parts = encryptedData.split(":");
      if (parts.length !== 2) {
        throw new Error("Invalid encrypted data format");
      }

      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];

      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        this.encryptionKey,
        iv,
      );
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      log.error("[Database] Decryption failed:", error);
      throw {
        code: "DB_DECRYPTION_ERROR",
        message: error instanceof Error ? error.message : "Decryption failed",
      };
    }
  }

  /**
   * Run database migrations
   * Migrations are version-tracked in schema_migrations table
   */
  private runMigrations(): void {
    if (!this.db) {
      throw { code: "DB_NOT_INITIALIZED", message: "Database not initialized" };
    }

    try {
      // Create migrations tracking table if not exists
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);

      // Get current schema version
      const currentVersion = this.getCurrentSchemaVersion();
      log.info("[Database] Current schema version:", currentVersion);

      // Get all migrations
      const migrations = this.getMigrations();

      // Apply pending migrations
      for (const migration of migrations) {
        if (migration.version > currentVersion) {
          log.info(`[Database] Applying migration v${migration.version}...`);

          this.db.exec(migration.up);

          // Record migration
          const stmt = this.db.prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          );
          stmt.run(migration.version, Date.now());

          log.info(
            `[Database] Migration v${migration.version} applied successfully`,
          );
        }
      }
    } catch (error) {
      log.error("[Database] Migration failed:", error);
      throw {
        code: "DB_MIGRATION_ERROR",
        message: error instanceof Error ? error.message : "Migration failed",
      };
    }
  }

  /**
   * Get current schema version from migrations table
   */
  private getCurrentSchemaVersion(): number {
    if (!this.db) {
      return 0;
    }

    try {
      const row = this.db
        .prepare("SELECT MAX(version) as version FROM schema_migrations")
        .get() as { version: number | null };

      return row.version ?? 0;
    } catch {
      // Table doesn't exist yet
      return 0;
    }
  }

  /**
   * Define all database migrations
   * Each migration includes upgrade (up) and rollback (down) SQL
   */
  private getMigrations(): Migration[] {
    return [
      {
        version: 1,
        up: `
          -- Epic 1: Pattern Detection and Automation
          CREATE TABLE patterns (
            id TEXT PRIMARY KEY,
            pattern_type TEXT NOT NULL,
            selector_path TEXT NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            confidence_score REAL NOT NULL,
            domain TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            metadata TEXT
          );

          CREATE INDEX idx_patterns_domain ON patterns(domain);
          CREATE INDEX idx_patterns_type ON patterns(pattern_type);

          CREATE TABLE automations (
            id TEXT PRIMARY KEY,
            pattern_id TEXT NOT NULL,
            automation_type TEXT NOT NULL,
            script_content TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            last_executed_at INTEGER,
            execution_count INTEGER DEFAULT 0,
            FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_automations_pattern ON automations(pattern_id);

          -- Epic 2: Page Monitoring System
          CREATE TABLE monitors (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            selector TEXT NOT NULL,
            schedule_cron TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            last_checked_at INTEGER,
            UNIQUE(url, selector)
          );

          CREATE INDEX idx_monitors_url ON monitors(url);

          CREATE TABLE snapshots (
            id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            html_content TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_snapshots_monitor ON snapshots(monitor_id);
          CREATE INDEX idx_snapshots_captured_at ON snapshots(captured_at);

          CREATE TABLE monitor_alerts (
            id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            change_summary TEXT NOT NULL,
            llm_analysis TEXT,
            severity TEXT NOT NULL,
            notified INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_alerts_monitor ON monitor_alerts(monitor_id);
          CREATE INDEX idx_alerts_severity ON monitor_alerts(severity);

          -- Epic 4: Preview API Workflow System
          CREATE TABLE workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL,
            last_executed_at INTEGER,
            execution_count INTEGER DEFAULT 0
          );

          CREATE TABLE workflow_steps (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            action_params TEXT NOT NULL,
            preview_required INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);

          CREATE TABLE audit_logs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT,
            step_id TEXT,
            action_type TEXT NOT NULL,
            action_params TEXT NOT NULL,
            preview_image TEXT,
            approved INTEGER NOT NULL,
            executed_at INTEGER NOT NULL,
            result TEXT,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL,
            FOREIGN KEY (step_id) REFERENCES workflow_steps(id) ON DELETE SET NULL
          );

          CREATE INDEX idx_audit_logs_workflow ON audit_logs(workflow_id);
          CREATE INDEX idx_audit_logs_executed_at ON audit_logs(executed_at);

          -- Epic 5: Data Analysis Toolkit
          CREATE TABLE execution_cache (
            id TEXT PRIMARY KEY,
            input_hash TEXT NOT NULL,
            code TEXT NOT NULL,
            result TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            accessed_at INTEGER NOT NULL,
            access_count INTEGER DEFAULT 1,
            UNIQUE(input_hash)
          );

          CREATE INDEX idx_execution_cache_accessed ON execution_cache(accessed_at);
        `,
        down: `
          DROP TABLE IF EXISTS execution_cache;
          DROP TABLE IF EXISTS audit_logs;
          DROP TABLE IF EXISTS workflow_steps;
          DROP TABLE IF EXISTS workflows;
          DROP TABLE IF EXISTS monitor_alerts;
          DROP TABLE IF EXISTS snapshots;
          DROP TABLE IF EXISTS monitors;
          DROP TABLE IF EXISTS automations;
          DROP TABLE IF EXISTS patterns;
        `,
      },
      {
        version: 2,
        up: `
          -- Story 1.2: Shared Notification System
          CREATE TABLE notifications (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('pattern', 'monitor', 'system')),
            severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error')),
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            data TEXT,
            created_at INTEGER NOT NULL,
            dismissed_at INTEGER
          );

          CREATE INDEX idx_notifications_created_at ON notifications(created_at);
          CREATE INDEX idx_notifications_type ON notifications(type);
          CREATE INDEX idx_notifications_dismissed ON notifications(dismissed_at);
        `,
        down: `
          DROP TABLE IF EXISTS notifications;
        `,
      },
      {
        version: 3,
        up: `
          -- Story 1.5: Monitor Management IPC Architecture
          -- Drop old monitors table (from v1) and create new schema with goal, frequency, status
          DROP TABLE IF EXISTS monitor_alerts;
          DROP TABLE IF EXISTS snapshots;
          DROP TABLE IF EXISTS monitors;

          CREATE TABLE monitors (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            goal TEXT,
            frequency TEXT NOT NULL CHECK(frequency IN ('1h', '2h', '4h', '6h')),
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error')),
            last_check INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE INDEX idx_monitors_status ON monitors(status);
          CREATE INDEX idx_monitors_created_at ON monitors(created_at);
        `,
        down: `
          DROP TABLE IF EXISTS monitors;
        `,
      },
      {
        version: 4,
        up: `
          -- Story 1.6: Navigation Pattern Tracking
          -- Update patterns table schema to support navigation, form, and copy-paste patterns
          -- Drop old patterns table (from v1) and recreate with new schema
          DROP TABLE IF EXISTS automations;
          DROP TABLE IF EXISTS patterns;

          CREATE TABLE patterns (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL
          );

          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);

          CREATE TABLE automations (
            id TEXT PRIMARY KEY,
            pattern_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            pattern_data TEXT NOT NULL,
            execution_count INTEGER DEFAULT 0,
            last_executed INTEGER,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
          );

          CREATE INDEX idx_automations_pattern ON automations(pattern_id);
        `,
        down: `
          DROP TABLE IF EXISTS automations;
          DROP TABLE IF EXISTS patterns;
        `,
      },
      {
        version: 5,
        up: `
          -- Story 1.10: Add execution tracking columns to automations
          -- Note: Migration for existing databases (v4 created without these columns)
          -- SQLite doesn't support ALTER TABLE ADD COLUMN with NOT NULL and no default,
          -- so we need to recreate the table if columns are missing

          -- Create new table with updated schema
          CREATE TABLE IF NOT EXISTS automations_new (
            id TEXT PRIMARY KEY,
            pattern_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            pattern_data TEXT NOT NULL,
            execution_count INTEGER DEFAULT 0,
            last_executed INTEGER,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
          );

          -- Copy existing data if old table exists, fetching pattern_data from patterns table
          INSERT OR IGNORE INTO automations_new (id, pattern_id, name, description, pattern_data, execution_count, last_executed, created_at)
          SELECT
            a.id,
            a.pattern_id,
            a.name,
            a.description,
            COALESCE(p.pattern_data, '{}') as pattern_data,
            0 as execution_count,
            NULL as last_executed,
            a.created_at
          FROM automations a
          LEFT JOIN patterns p ON a.pattern_id = p.id
          WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='automations');

          -- Drop old table and rename new table
          DROP TABLE IF EXISTS automations;
          ALTER TABLE automations_new RENAME TO automations;

          -- Recreate index
          CREATE INDEX idx_automations_pattern ON automations(pattern_id);
        `,
        down: `
          -- Revert to v4 schema (remove execution columns)
          CREATE TABLE automations_old (
            id TEXT PRIMARY KEY,
            pattern_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
          );

          INSERT INTO automations_old (id, pattern_id, name, description, created_at)
          SELECT id, pattern_id, name, description, created_at FROM automations;

          DROP TABLE automations;
          ALTER TABLE automations_old RENAME TO automations;

          CREATE INDEX idx_automations_pattern ON automations(pattern_id);
        `,
      },
      {
        version: 6,
        up: `
          -- Story 1.12: AI Pattern Intent Summarization
          -- Add intent_summary and summary_generated_at columns to patterns table
          ALTER TABLE patterns ADD COLUMN intent_summary TEXT;
          ALTER TABLE patterns ADD COLUMN summary_generated_at INTEGER;
        `,
        down: `
          -- Revert to v5 schema (remove AI columns)
          -- Note: SQLite doesn't support DROP COLUMN, so we need to recreate the table
          CREATE TABLE patterns_old (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL
          );

          INSERT INTO patterns_old SELECT id, type, pattern_data, confidence, occurrence_count, first_seen, last_seen, dismissed, created_at FROM patterns;

          DROP TABLE patterns;
          ALTER TABLE patterns_old RENAME TO patterns;

          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
      },
      {
        version: 7,
        up: `
          -- Story 1.12 Enhancement: Dual-level summaries
          -- Add detailed summary for chat interface (short summary already exists)
          ALTER TABLE patterns ADD COLUMN intent_summary_detailed TEXT;
        `,
        down: `
          -- Revert to v6 schema (remove detailed summary)
          -- Note: SQLite doesn't support DROP COLUMN directly
          CREATE TABLE patterns_temp (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            intent_summary TEXT,
            summary_generated_at INTEGER
          );

          INSERT INTO patterns_temp SELECT id, type, pattern_data, confidence, occurrence_count, first_seen, last_seen, dismissed, created_at, intent_summary, summary_generated_at FROM patterns;

          DROP TABLE patterns;
          ALTER TABLE patterns_temp RENAME TO patterns;

          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
      },
      {
        version: 8,
        up: `
          -- Story 1.17: Conversational Workflow Refinement
          -- Add workflow and intent_summary columns to automations table
          ALTER TABLE automations ADD COLUMN workflow TEXT;
          ALTER TABLE automations ADD COLUMN intent_summary TEXT;
          ALTER TABLE automations ADD COLUMN updated_at INTEGER;
        `,
        down: `
          -- Revert to v7 schema (remove workflow columns)
          -- Note: SQLite doesn't support DROP COLUMN directly
          CREATE TABLE automations_temp (
            id TEXT PRIMARY KEY,
            pattern_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            pattern_data TEXT NOT NULL,
            execution_count INTEGER DEFAULT 0,
            last_executed INTEGER,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
          );

          INSERT INTO automations_temp
          SELECT id, pattern_id, name, description, pattern_data, execution_count, last_executed, created_at
          FROM automations;

          DROP TABLE automations;
          ALTER TABLE automations_temp RENAME TO automations;

          CREATE INDEX idx_automations_pattern ON automations(pattern_id);
        `,
      },
      {
        version: 9,
        up: `
          -- Story 1.18: Cross-Tab Pattern Tracking
          -- Add 'tab_switch' to allowed pattern types
          -- SQLite doesn't support ALTER TABLE MODIFY CONSTRAINT, so recreate the table
          CREATE TABLE patterns_new (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste', 'tab_switch')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            intent_summary TEXT,
            summary_generated_at INTEGER,
            intent_summary_detailed TEXT
          );

          -- Copy existing data
          INSERT INTO patterns_new SELECT * FROM patterns;

          -- Drop old table and rename new table
          DROP TABLE patterns;
          ALTER TABLE patterns_new RENAME TO patterns;

          -- Recreate indexes
          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
        down: `
          -- Revert to v8 schema (remove 'tab_switch' from allowed types)
          CREATE TABLE patterns_old (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            intent_summary TEXT,
            summary_generated_at INTEGER,
            intent_summary_detailed TEXT
          );

          -- Copy data, excluding tab_switch patterns
          INSERT INTO patterns_old SELECT * FROM patterns WHERE type != 'tab_switch';

          DROP TABLE patterns;
          ALTER TABLE patterns_old RENAME TO patterns;

          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
      },
      {
        version: 10,
        up: `
          -- Story 1.18 Course Correction: Remove 'tab_switch' from allowed pattern types
          -- Decision: Tab switches are metadata only, not a separate pattern type
          -- Cross-tab workflows saved as their primary type (copy-paste, navigation) with tab metadata
          CREATE TABLE patterns_v10 (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            intent_summary TEXT,
            summary_generated_at INTEGER,
            intent_summary_detailed TEXT
          );

          -- Copy existing data, excluding tab_switch patterns (migrate to copy-paste type)
          INSERT INTO patterns_v10
          SELECT
            id,
            CASE WHEN type = 'tab_switch' THEN 'copy-paste' ELSE type END as type,
            pattern_data,
            confidence,
            occurrence_count,
            first_seen,
            last_seen,
            dismissed,
            created_at,
            intent_summary,
            summary_generated_at,
            intent_summary_detailed
          FROM patterns;

          -- Drop old table and rename new table
          DROP TABLE patterns;
          ALTER TABLE patterns_v10 RENAME TO patterns;

          -- Recreate indexes
          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
        down: `
          -- Revert to v9 schema (restore tab_switch type)
          CREATE TABLE patterns_v9 (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('navigation', 'form', 'copy-paste', 'tab_switch')),
            pattern_data TEXT NOT NULL,
            confidence REAL NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            dismissed BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            intent_summary TEXT,
            summary_generated_at INTEGER,
            intent_summary_detailed TEXT
          );

          INSERT INTO patterns_v9 SELECT * FROM patterns;

          DROP TABLE patterns;
          ALTER TABLE patterns_v9 RENAME TO patterns;

          CREATE INDEX idx_patterns_type ON patterns(type);
          CREATE INDEX idx_patterns_confidence ON patterns(confidence);
          CREATE INDEX idx_patterns_dismissed ON patterns(dismissed);
          CREATE INDEX idx_patterns_created_at ON patterns(created_at);
        `,
      },
    ];
  }

  /**
   * Cleanup old patterns (>30 days)
   * Called periodically or on app quit
   * Note: After migration v4, uses 'created_at' column
   */
  public cleanupOldPatterns(): void {
    if (!this.db) {
      log.warn("[Database] Cannot cleanup: database not initialized");
      return;
    }

    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const stmt = this.db.prepare("DELETE FROM patterns WHERE created_at < ?");
      const result = stmt.run(thirtyDaysAgo);

      log.info(`[Database] Cleaned up ${result.changes} old patterns`);
    } catch (error) {
      log.error("[Database] Cleanup failed:", error);
      throw {
        code: "DB_CLEANUP_ERROR",
        message: error instanceof Error ? error.message : "Cleanup failed",
      };
    }
  }

  /**
   * Optimize database with VACUUM
   * Reclaims unused space and defragments
   */
  public vacuum(): void {
    if (!this.db) {
      log.warn("[Database] Cannot vacuum: database not initialized");
      return;
    }

    try {
      log.info("[Database] Running VACUUM...");
      this.db.exec("VACUUM");
      log.info("[Database] VACUUM completed");
    } catch (error) {
      log.error("[Database] VACUUM failed:", error);
      throw {
        code: "DB_VACUUM_ERROR",
        message: error instanceof Error ? error.message : "VACUUM failed",
      };
    }
  }

  /**
   * Create database backup
   * Returns backup file path
   */
  public backup(): string {
    if (!this.db) {
      throw { code: "DB_NOT_INITIALIZED", message: "Database not initialized" };
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${this.dbPath}.backup-${timestamp}`;

      log.info("[Database] Creating backup:", backupPath);
      this.db.backup(backupPath);
      log.info("[Database] Backup created successfully");

      return backupPath;
    } catch (error) {
      log.error("[Database] Backup failed:", error);
      throw {
        code: "DB_BACKUP_ERROR",
        message: error instanceof Error ? error.message : "Backup failed",
      };
    }
  }

  /**
   * Get database instance for queries
   * Always use prepared statements to prevent SQL injection
   */
  public getDatabase(): Database.Database {
    if (!this.db) {
      throw { code: "DB_NOT_INITIALIZED", message: "Database not initialized" };
    }
    return this.db;
  }

  /**
   * Close database connection
   * Called on app quit
   */
  public close(): void {
    if (this.db) {
      try {
        log.info("[Database] Closing database connection...");

        // Cleanup old patterns before closing
        this.cleanupOldPatterns();

        // Optimize database
        this.vacuum();

        this.db.close();
        this.db = null;
        log.info("[Database] Database connection closed");
      } catch (error) {
        log.error("[Database] Error closing database:", error);
        throw {
          code: "DB_CLOSE_ERROR",
          message: error instanceof Error ? error.message : "Close failed",
        };
      }
    }
  }
}
