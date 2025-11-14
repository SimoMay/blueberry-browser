import Database from "better-sqlite3";
import log from "electron-log";
import { PatternType, NavigationPattern, FormPattern } from "./PatternManager";
import { NotificationManager } from "./NotificationManager";
import { EventManager } from "./EventManager";

/**
 * Recognized pattern with confidence score and notification readiness
 */
export interface RecognizedPattern {
  id: string;
  type: PatternType;
  confidence: number;
  occurrenceCount: number;
  readyForNotification: boolean;
}

/**
 * Pattern database row structure
 */
interface PatternRow {
  id: string;
  type: PatternType;
  pattern_data: string;
  occurrence_count: number;
  confidence: number;
  dismissed: number;
  first_seen?: number;
  last_seen?: number;
}

/**
 * Pattern recognition algorithm manager
 *
 * Architecture decisions:
 * - Singleton pattern (matches PatternManager)
 * - Background processing every 5 minutes
 * - Levenshtein distance for navigation sequence similarity
 * - Jaccard similarity for form field set comparison
 * - Confidence scoring: (occurrence_count * consistency) / 5 * 100
 * - Notification threshold: occurrence_count >= 2 AND confidence > 50% (balanced for usability)
 * - Performance target: <2 seconds per run
 * - CPU usage: <15% during recognition
 * - Memory overhead: <50MB
 */
export class PatternRecognizer {
  private static instance: PatternRecognizer | null = null;
  private db: Database.Database | null = null;
  private notificationManager: NotificationManager | null = null;
  private eventManager: EventManager | null = null;
  private jobInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Configuration constants
  private readonly SIMILARITY_THRESHOLD = 0.8; // 80% similarity for pattern grouping
  private readonly CONFIDENCE_THRESHOLD = 50; // Minimum confidence for notifications (balanced for usability)
  private readonly OCCURRENCE_THRESHOLD = 2; // Minimum occurrences for notifications (balanced for usability)
  private readonly INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Private constructor for singleton pattern
   */
  private constructor(db: Database.Database) {
    this.db = db;
    log.info("[PatternRecognizer] Instance created");
  }

  /**
   * Get singleton instance
   */
  public static getInstance(db?: Database.Database): PatternRecognizer {
    if (!PatternRecognizer.instance && db) {
      PatternRecognizer.instance = new PatternRecognizer(db);
    }
    if (!PatternRecognizer.instance) {
      throw new Error(
        "PatternRecognizer not initialized. Call getInstance(db) first.",
      );
    }
    return PatternRecognizer.instance;
  }

  /**
   * Set NotificationManager instance (for late binding after initialization)
   */
  public setNotificationManager(
    notificationManager: NotificationManager,
  ): void {
    this.notificationManager = notificationManager;
  }

  /**
   * Set EventManager instance (for late binding after initialization)
   */
  public setEventManager(eventManager: EventManager): void {
    this.eventManager = eventManager;
  }

  /**
   * Main pattern recognition algorithm
   * Analyzes all patterns, calculates confidence scores, and triggers notifications
   *
   * @returns Array of recognized patterns with confidence scores
   */
  public async analyzePatterns(): Promise<RecognizedPattern[]> {
    if (this.isRunning) {
      log.info("[PatternRecognizer] Recognition already running, skipping...");
      return [];
    }

    this.isRunning = true;
    const startTime = Date.now();
    const startMem = process.memoryUsage().heapUsed / 1024 / 1024;

    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      log.info("[PatternRecognizer] Starting pattern analysis...");

      // 1. Fetch all non-dismissed patterns
      const patterns = this.fetchPatterns();
      log.info(
        `[PatternRecognizer] Fetched ${patterns.length} patterns for analysis`,
      );

      // 2. Group by type
      const navigationPatterns = patterns.filter(
        (p) => p.type === "navigation",
      );
      const formPatterns = patterns.filter((p) => p.type === "form");

      log.info(
        `[PatternRecognizer] Pattern distribution: ${navigationPatterns.length} navigation, ${formPatterns.length} form`,
      );

      // 3. Analyze each group
      const recognizedNavigation =
        this.analyzeNavigationPatterns(navigationPatterns);
      const recognizedForms = this.analyzeFormPatterns(formPatterns);

      // 4. Combine results
      const allRecognized = [...recognizedNavigation, ...recognizedForms];

      // 5. Update database with confidence scores
      this.updatePatternConfidence(allRecognized);

      // 6. Trigger notifications for patterns meeting threshold
      await this.triggerNotifications(allRecognized);

      // Performance metrics
      const duration = Date.now() - startTime;
      const endMem = process.memoryUsage().heapUsed / 1024 / 1024;
      const memDelta = endMem - startMem;

      log.info("[PatternRecognizer] Analysis complete", {
        patternsAnalyzed: patterns.length,
        recognized: allRecognized.length,
        durationMs: duration,
        memoryUsedMB: memDelta.toFixed(2),
      });

      // Alert if exceeds performance targets
      if (duration > 2000) {
        log.warn(
          `[PatternRecognizer] Analysis exceeded 2s target: ${duration}ms`,
        );
      }

      return allRecognized;
    } catch (error) {
      log.error("[PatternRecognizer] Analysis error:", error);
      return [];
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch all non-dismissed patterns from database
   */
  private fetchPatterns(): PatternRow[] {
    if (!this.db) {
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, type, pattern_data, occurrence_count, confidence, dismissed
        FROM patterns
        WHERE dismissed = 0
        ORDER BY last_seen DESC
      `);

      return stmt.all() as PatternRow[];
    } catch (error) {
      log.error("[PatternRecognizer] Error fetching patterns:", error);
      return [];
    }
  }

  /**
   * Analyze navigation patterns using Levenshtein distance
   * Compares URL sequences to detect similar patterns
   *
   * @param patterns Navigation pattern rows from database
   * @returns Array of recognized patterns with confidence scores
   */
  private analyzeNavigationPatterns(
    patterns: PatternRow[],
  ): RecognizedPattern[] {
    const recognized: RecognizedPattern[] = [];

    for (let i = 0; i < patterns.length; i++) {
      const patternA = patterns[i];

      try {
        const dataA = JSON.parse(patternA.pattern_data) as NavigationPattern;

        // Compare with other patterns to calculate consistency
        let similaritySum = 0;
        let comparisonCount = 0;

        for (let j = 0; j < patterns.length; j++) {
          if (i === j) continue;

          const patternB = patterns[j];

          try {
            const dataB = JSON.parse(
              patternB.pattern_data,
            ) as NavigationPattern;

            const similarity = this.compareNavigationSequences(
              dataA.sequence,
              dataB.sequence,
            );

            if (similarity >= this.SIMILARITY_THRESHOLD) {
              similaritySum += similarity;
              comparisonCount++;
            }
          } catch (error) {
            log.error(
              `[PatternRecognizer] Error parsing pattern ${patternB.id}:`,
              error,
            );
            continue;
          }
        }

        // Calculate confidence score
        // Consistency score: average similarity with other patterns
        const consistencyScore =
          comparisonCount > 0 ? similaritySum / comparisonCount : 1.0;

        // Confidence formula: (occurrence_count * consistency) / 5 * 100, capped at 100
        const confidence = Math.min(
          (patternA.occurrence_count * consistencyScore * 100) / 5,
          100,
        );

        // Check if ready for notification
        const readyForNotification =
          patternA.occurrence_count >= this.OCCURRENCE_THRESHOLD &&
          confidence > this.CONFIDENCE_THRESHOLD;

        recognized.push({
          id: patternA.id,
          type: "navigation",
          confidence: Math.round(confidence * 100) / 100, // Round to 2 decimals
          occurrenceCount: patternA.occurrence_count,
          readyForNotification,
        });
      } catch (error) {
        log.error(
          `[PatternRecognizer] Error analyzing navigation pattern ${patternA.id}:`,
          error,
        );
        continue;
      }
    }

    return recognized;
  }

  /**
   * Analyze form patterns using Jaccard similarity
   * Compares field sets to detect similar forms
   *
   * @param patterns Form pattern rows from database
   * @returns Array of recognized patterns with confidence scores
   */
  private analyzeFormPatterns(patterns: PatternRow[]): RecognizedPattern[] {
    const recognized: RecognizedPattern[] = [];

    for (let i = 0; i < patterns.length; i++) {
      const patternA = patterns[i];

      try {
        const dataA = JSON.parse(patternA.pattern_data) as FormPattern;

        // Compare with other patterns to calculate consistency
        let similaritySum = 0;
        let comparisonCount = 0;

        for (let j = 0; j < patterns.length; j++) {
          if (i === j) continue;

          const patternB = patterns[j];

          try {
            const dataB = JSON.parse(patternB.pattern_data) as FormPattern;

            const similarity = this.compareFormFields(
              dataA.fields,
              dataB.fields,
            );

            if (similarity >= this.SIMILARITY_THRESHOLD) {
              similaritySum += similarity;
              comparisonCount++;
            }
          } catch (error) {
            log.error(
              `[PatternRecognizer] Error parsing pattern ${patternB.id}:`,
              error,
            );
            continue;
          }
        }

        // Calculate confidence score
        const consistencyScore =
          comparisonCount > 0 ? similaritySum / comparisonCount : 1.0;

        const confidence = Math.min(
          (patternA.occurrence_count * consistencyScore * 100) / 5,
          100,
        );

        // Check if ready for notification
        const readyForNotification =
          patternA.occurrence_count >= this.OCCURRENCE_THRESHOLD &&
          confidence > this.CONFIDENCE_THRESHOLD;

        recognized.push({
          id: patternA.id,
          type: "form",
          confidence: Math.round(confidence * 100) / 100,
          occurrenceCount: patternA.occurrence_count,
          readyForNotification,
        });
      } catch (error) {
        log.error(
          `[PatternRecognizer] Error analyzing form pattern ${patternA.id}:`,
          error,
        );
        continue;
      }
    }

    return recognized;
  }

  /**
   * Compare navigation sequences using Levenshtein distance
   * Returns similarity score between 0 and 1
   *
   * @param seqA First navigation sequence
   * @param seqB Second navigation sequence
   * @returns Similarity score (0-1)
   */
  private compareNavigationSequences(
    seqA: NavigationPattern["sequence"],
    seqB: NavigationPattern["sequence"],
  ): number {
    if (!seqA || !seqB || seqA.length === 0 || seqB.length === 0) {
      return 0;
    }

    // Extract URL arrays from sequences
    const urlsA = seqA.map((s) => s.url);
    const urlsB = seqB.map((s) => s.url);

    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(urlsA, urlsB);
    const maxLength = Math.max(urlsA.length, urlsB.length);

    // Convert distance to similarity (0-1)
    return maxLength > 0 ? 1 - distance / maxLength : 0;
  }

  /**
   * Calculate Levenshtein distance between two string arrays
   * Measures minimum number of edits needed to transform one array into another
   *
   * @param a First array
   * @param b Second array
   * @returns Edit distance
   */
  private levenshteinDistance(a: string[], b: string[]): number {
    const matrix: number[][] = [];

    // Initialize first column (deletion costs)
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    // Initialize first row (insertion costs)
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          // Elements match - no edit needed
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          // Elements differ - take minimum of three operations
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Compare form field sets using Jaccard similarity
   * Returns similarity score between 0 and 1
   *
   * @param fieldsA First field set
   * @param fieldsB Second field set
   * @returns Similarity score (0-1)
   */
  private compareFormFields(
    fieldsA: FormPattern["fields"],
    fieldsB: FormPattern["fields"],
  ): number {
    if (!fieldsA || !fieldsB || fieldsA.length === 0 || fieldsB.length === 0) {
      return 0;
    }

    // Extract field names as sets
    const namesA = new Set(fieldsA.map((f) => f.name));
    const namesB = new Set(fieldsB.map((f) => f.name));

    // Calculate intersection and union
    const intersection = new Set([...namesA].filter((x) => namesB.has(x)));
    const union = new Set([...namesA, ...namesB]);

    // Jaccard similarity: |intersection| / |union|
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Update pattern confidence scores in database
   *
   * @param patterns Recognized patterns with calculated confidence
   */
  private updatePatternConfidence(patterns: RecognizedPattern[]): void {
    if (!this.db) {
      return;
    }

    try {
      const stmt = this.db.prepare(`
        UPDATE patterns
        SET confidence = ?
        WHERE id = ?
      `);

      for (const pattern of patterns) {
        stmt.run(pattern.confidence, pattern.id);
      }

      log.info(
        `[PatternRecognizer] Updated confidence for ${patterns.length} patterns`,
      );
    } catch (error) {
      log.error(
        "[PatternRecognizer] Error updating pattern confidence:",
        error,
      );
    }
  }

  /**
   * Fetch complete pattern data from database by ID
   * @param id Pattern ID to fetch
   * @returns Pattern data with parsed JSON or null if not found
   */
  private fetchPatternById(id: string): {
    id: string;
    type: PatternType;
    confidence: number;
    occurrenceCount: number;
    firstSeen?: number;
    lastSeen?: number;
    patternData: NavigationPattern | FormPattern;
  } | null {
    if (!this.db) {
      log.error("[PatternRecognizer] Database not initialized");
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, type, pattern_data, confidence, occurrence_count, first_seen, last_seen
        FROM patterns
        WHERE id = ? AND dismissed = 0
      `);

      const row = stmt.get(id) as PatternRow | undefined;
      if (row) {
        return {
          id: row.id,
          type: row.type,
          confidence: row.confidence,
          occurrenceCount: row.occurrence_count,
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          patternData: JSON.parse(row.pattern_data),
        };
      }
      return null;
    } catch (error) {
      log.error("[PatternRecognizer] Error fetching pattern by ID:", error);
      return null;
    }
  }

  /**
   * Trigger notifications for patterns meeting threshold
   * Patterns must have: occurrence_count >= 2 AND confidence > 50% (balanced for usability)
   *
   * @param patterns Recognized patterns to check for notification
   */
  private async triggerNotifications(
    patterns: RecognizedPattern[],
  ): Promise<void> {
    const notificationPatterns = patterns.filter((p) => p.readyForNotification);

    for (const pattern of notificationPatterns) {
      // Fetch complete pattern data from database
      const patternData = this.fetchPatternById(pattern.id);

      if (patternData && this.notificationManager && this.eventManager) {
        try {
          // Check if notification already exists for this pattern (prevent duplicates)
          const existingNotifications =
            await this.notificationManager.getNotifications("pattern");
          const alreadyNotified = existingNotifications.some((n) => {
            try {
              const data =
                typeof n.data === "string" ? JSON.parse(n.data) : n.data;
              return data?.id === pattern.id && !n.dismissed_at;
            } catch {
              return false;
            }
          });

          if (alreadyNotified) {
            continue;
          }

          // Create notification through existing NotificationManager (Story 1.9 refactor)
          const notification =
            await this.notificationManager.createNotification({
              type: "pattern",
              severity: "info",
              title: "Pattern Detected",
              message: `${pattern.type === "navigation" ? "Navigation" : "Form"} pattern detected with ${pattern.confidence.toFixed(0)}% confidence`,
              data: patternData as Record<string, unknown>, // Store pattern data as object
            });

          // Broadcast notification to sidebar UI
          this.eventManager.broadcastNotification(notification);
        } catch (error) {
          log.error("[PatternRecognizer] Error creating notification:", error);
        }
      } else if (patternData && !this.notificationManager) {
        log.warn(
          "[PatternRecognizer] NotificationManager not set, cannot create notification",
        );
      } else if (patternData && !this.eventManager) {
        log.warn(
          "[PatternRecognizer] EventManager not set, cannot broadcast notification",
        );
      }
    }
  }

  /**
   * Start background job
   * Runs pattern analysis every 5 minutes
   */
  public startBackgroundJob(): void {
    if (this.jobInterval) {
      log.warn("[PatternRecognizer] Background job already running");
      return;
    }

    log.info(
      `[PatternRecognizer] Starting background job (interval: ${this.INTERVAL_MS}ms / 5 minutes)`,
    );

    this.jobInterval = setInterval(() => {
      log.info("[PatternRecognizer] Running scheduled analysis...");
      this.analyzePatterns().catch((error) => {
        log.error("[PatternRecognizer] Scheduled analysis error:", error);
      });
    }, this.INTERVAL_MS);

    log.info("[PatternRecognizer] Background job started");
  }

  /**
   * Stop background job
   * Called on app shutdown
   */
  public stopBackgroundJob(): void {
    if (this.jobInterval) {
      clearInterval(this.jobInterval);
      this.jobInterval = null;
      log.info("[PatternRecognizer] Background job stopped");
    }
  }

  /**
   * Manual trigger for pattern analysis
   * Called on tab close events for immediate pattern detection
   */
  public async triggerAnalysis(): Promise<void> {
    log.info("[PatternRecognizer] Manual analysis triggered");
    await this.analyzePatterns();
  }
}
