import Database from "better-sqlite3";
import log from "electron-log";
import {
  PatternType,
  NavigationPattern,
  FormPattern,
  CopyPastePattern,
} from "./PatternManager";
import { NotificationManager } from "./NotificationManager";
import { EventManager } from "./EventManager";
import { IntentSummarizer } from "./IntentSummarizer"; // Story 1.12

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
  intent_summary?: string; // Story 1.13 - SHORT summary (20-30 words)
  intent_summary_detailed?: string; // Story 1.13 - DETAILED summary (40-50 words)
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
  private intentSummarizer: IntentSummarizer | null = null; // Story 1.12
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
    this.intentSummarizer = IntentSummarizer.getInstance(db); // Story 1.12
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

      // 5.5. Generate intent summaries for patterns with confidence >70% (Story 1.12 - AC 1)
      await this.generateIntentSummaries(allRecognized);

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
    intentSummary?: string; // SHORT summary (20-30 words) - Story 1.13
    intentSummaryDetailed?: string; // DETAILED summary (40-50 words) - Story 1.13
  } | null {
    if (!this.db) {
      log.error("[PatternRecognizer] Database not initialized");
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, type, pattern_data, confidence, occurrence_count, first_seen, last_seen,
               intent_summary, intent_summary_detailed
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
          intentSummary: row.intent_summary || undefined, // Story 1.13 - SHORT summary
          intentSummaryDetailed: row.intent_summary_detailed || undefined, // Story 1.13 - DETAILED summary
        };
      }
      return null;
    } catch (error) {
      log.error("[PatternRecognizer] Error fetching pattern by ID:", error);
      return null;
    }
  }

  /**
   * Generate intent summaries for patterns with confidence >70%
   * Story 1.12 - AC 1: Single LLM call per pattern, cached for 1 hour
   *
   * @param patterns Recognized patterns to generate summaries for
   */
  private async generateIntentSummaries(
    patterns: RecognizedPattern[],
  ): Promise<void> {
    if (!this.intentSummarizer) {
      log.warn(
        "[PatternRecognizer] IntentSummarizer not initialized, skipping summary generation",
      );
      return;
    }

    // Filter patterns with confidence >70%
    const highConfidencePatterns = patterns.filter((p) => p.confidence > 70);

    if (highConfidencePatterns.length === 0) {
      log.info(
        "[PatternRecognizer] No patterns with confidence >70% for summarization",
      );
      return;
    }

    log.info(
      `[PatternRecognizer] Generating intent summaries for ${highConfidencePatterns.length} high-confidence patterns`,
    );

    // Generate summaries (with error handling per pattern)
    for (const pattern of highConfidencePatterns) {
      try {
        const summaries = await this.intentSummarizer.summarizePattern(
          pattern.id,
        );
        log.info(
          `[PatternRecognizer] Intent summaries for ${pattern.id}:\n  Short: "${summaries.short}"\n  Detailed: "${summaries.detailed}"`,
        );
      } catch (error) {
        log.error(
          `[PatternRecognizer] Failed to generate summaries for ${pattern.id}:`,
          error,
        );
        // Continue with other patterns - summary failure shouldn't block recognition
      }
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

          // Story 1.13 - AC 1: Use SHORT summary if available, otherwise fall back to template
          const notificationMessage = patternData.intentSummary
            ? patternData.intentSummary
            : `${pattern.type === "navigation" ? "Navigation" : pattern.type === "form" ? "Form" : "Copy/Paste"} pattern detected with ${pattern.confidence.toFixed(0)}% confidence`;

          // Create notification through existing NotificationManager (Story 1.9 refactor)
          const notification =
            await this.notificationManager.createNotification({
              type: "pattern",
              severity: "info",
              title: "Pattern Detected",
              message: notificationMessage,
              data: patternData as Record<string, unknown>, // Store pattern data as object (includes intent summaries)
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

  /**
   * Session action tracking for mid-workflow detection (Story 1.14)
   */
  private sessionActions: Array<{
    type: string;
    data: unknown;
    timestamp: number;
  }> = [];
  private lastSuggestionTimestamp = 0;
  private readonly SUGGESTION_COOLDOWN_MS = 10 * 1000; // 10 seconds cooldown (Story 1.14 - reduced for better UX)

  /**
   * Track user action in current session (Story 1.14)
   * Called by PatternManager when user performs trackable actions
   */
  public trackSessionAction(type: string, data: unknown): void {
    this.sessionActions.push({
      type,
      data,
      timestamp: Date.now(),
    });

    // Keep only last 50 actions to avoid memory bloat
    if (this.sessionActions.length > 50) {
      this.sessionActions.shift();
    }

    // Trigger mid-workflow detection
    this.detectMidWorkflowPattern().catch((error) => {
      log.error("[PatternRecognizer] Mid-workflow detection error:", error);
    });
  }

  /**
   * Detect mid-workflow pattern and trigger proactive suggestions (Story 1.14)
   * Analyzes session actions against stored patterns
   * Triggers suggestion after 2-3 iterations detected
   */
  public async detectMidWorkflowPattern(): Promise<void> {
    try {
      // Cooldown check - don't spam suggestions
      const now = Date.now();
      if (now - this.lastSuggestionTimestamp < this.SUGGESTION_COOLDOWN_MS) {
        log.info(
          `[PatternRecognizer] Mid-workflow detection skipped: cooldown active (${Math.round((this.SUGGESTION_COOLDOWN_MS - (now - this.lastSuggestionTimestamp)) / 1000)}s remaining)`,
        );
        return;
      }

      // Fetch high-confidence patterns (>70%) with intent summaries
      const patterns = this.fetchPatternsForMidWorkflow();

      log.info(
        `[PatternRecognizer] Mid-workflow check: ${patterns.length} eligible patterns, ${this.sessionActions.length} session actions`,
      );

      if (patterns.length === 0) {
        return;
      }

      // Compare session actions against each pattern and collect matches
      const matchedPatterns: Array<{
        pattern: PatternRow;
        matchCount: number;
        sequenceLength: number;
      }> = [];

      for (const pattern of patterns) {
        const matchCount = this.countRecentMatches(pattern);

        // Only log patterns with actual matches (reduces log spam)
        if (matchCount > 0) {
          log.info(
            `[PatternRecognizer] Pattern ${pattern.id} (${pattern.type}): ${matchCount} matches`,
          );
        }

        // Collect patterns with 2+ matches
        if (matchCount >= 2) {
          const patternData = JSON.parse(pattern.pattern_data);

          // For navigation patterns, use iteration length (not full recorded history)
          let sequenceLength = 1;
          if (pattern.type === "navigation") {
            const navPattern = patternData as NavigationPattern;
            const iteration = this.extractPatternIteration(navPattern);
            sequenceLength = iteration.length;
          } else {
            sequenceLength =
              patternData.fields?.length || patternData.pairs?.length || 1;
          }

          matchedPatterns.push({
            pattern,
            matchCount,
            sequenceLength,
          });
        }
      }

      // Sort by sequence length (prefer longer, more complex patterns)
      // Then by match count (prefer more repetitions)
      matchedPatterns.sort((a, b) => {
        if (b.sequenceLength !== a.sequenceLength) {
          return b.sequenceLength - a.sequenceLength; // Longer first
        }
        return b.matchCount - a.matchCount; // More matches first
      });

      // Suggest the best matching pattern (longest, most repeated)
      if (matchedPatterns.length > 0) {
        const { pattern, matchCount } = matchedPatterns[0];
        log.info(
          `[PatternRecognizer] Best match: ${pattern.id} (${matchedPatterns[0].sequenceLength} steps, ${matchCount} matches)`,
        );

        // Trigger suggestion after 2+ matches detected (not just 2-3, allow ongoing patterns)
        // Cooldown mechanism prevents spam
        {
          const estimatedItems = this.estimateRemainingItems(pattern);

          // Send proactive suggestion to sidebar
          if (this.window) {
            const patternData = this.fetchPatternById(pattern.id);
            if (patternData) {
              // Use intent summary if available, otherwise generate template
              const intentSummary =
                patternData.intentSummary ||
                this.generateTemplateSummary(
                  pattern.type,
                  patternData.patternData,
                );

              // Broadcast suggestion to sidebar
              const suggestionData = {
                patternId: pattern.id,
                intentSummary,
                estimatedItems,
                matchCount,
              };

              log.info(
                `[PatternRecognizer] Sending IPC event to sidebar:`,
                suggestionData,
              );

              // Send suggestion to sidebar using helper method (Story 1.14)
              if (this.window) {
                this.window.sendToSidebar(
                  "pattern:suggest-continuation",
                  suggestionData,
                );
                log.info(
                  `[PatternRecognizer] Proactive suggestion sent to sidebar`,
                );
              } else {
                log.error(
                  `[PatternRecognizer] Cannot send suggestion: Window not initialized`,
                );
              }

              log.info(
                `[PatternRecognizer] Mid-workflow suggestion triggered: ${pattern.id} (${matchCount} matches, ~${estimatedItems} items remaining)`,
              );

              // Update cooldown timestamp
              this.lastSuggestionTimestamp = now;
            }
          } else {
            log.warn(
              `[PatternRecognizer] Cannot send suggestion: Window not initialized`,
            );
          }
        }
      }
    } catch (error) {
      log.error("[PatternRecognizer] Mid-workflow detection error:", error);
    }
  }

  /**
   * Fetch patterns suitable for mid-workflow detection
   * Filters: Not dismissed only (no confidence threshold)
   * Note: Detection relies on session repetition counting (2-3 matches),
   *       not historical pattern confidence
   */
  private fetchPatternsForMidWorkflow(): PatternRow[] {
    if (!this.db) {
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, type, pattern_data, occurrence_count, confidence,
               intent_summary, intent_summary_detailed
        FROM patterns
        WHERE dismissed = 0
        ORDER BY last_seen DESC
        LIMIT 50
      `);

      return stmt.all() as PatternRow[];
    } catch (error) {
      log.error(
        "[PatternRecognizer] Error fetching patterns for mid-workflow:",
        error,
      );
      return [];
    }
  }

  /**
   * Extract one iteration of a navigation pattern by detecting pattern repetition
   * Finds when the sequence returns to the starting domain after visiting other domains
   */
  private extractPatternIteration(navPattern: NavigationPattern): Array<{
    url: string;
    timestamp: number;
    tabId: string;
  }> {
    if (navPattern.sequence.length === 0) {
      return [];
    }

    // If only 1 URL, that's the iteration
    if (navPattern.sequence.length === 1) {
      return [navPattern.sequence[0]];
    }

    const iteration = [navPattern.sequence[0]];

    try {
      // Extract starting domain
      const startingDomain = new URL(navPattern.sequence[0].url).hostname;
      let visitedDifferentDomain = false;

      // Continue adding URLs until we return to the starting domain (after visiting elsewhere)
      for (let i = 1; i < navPattern.sequence.length; i++) {
        const currentUrl = navPattern.sequence[i].url;
        const currentDomain = new URL(currentUrl).hostname;

        // Track if we've left the starting domain
        if (currentDomain !== startingDomain) {
          visitedDifferentDomain = true;
        }

        iteration.push(navPattern.sequence[i]);

        // Only consider it a "return" if we've been somewhere else first
        if (
          currentDomain === startingDomain &&
          visitedDifferentDomain &&
          i > 0
        ) {
          break;
        }
      }
    } catch (error) {
      log.error(
        "[PatternRecognizer] Error extracting pattern iteration:",
        error,
      );
      // Fallback: return first element if URL parsing fails
      return [navPattern.sequence[0]];
    }

    return iteration;
  }

  /**
   * Count how many times a pattern has been repeated in current session
   * Heuristic: Look for similar action sequences in session history
   */
  private countRecentMatches(pattern: PatternRow): number {
    try {
      const patternData = JSON.parse(pattern.pattern_data);

      if (pattern.type === "navigation") {
        // Count navigation sequences matching this pattern
        const navPattern = patternData as NavigationPattern;

        // Extract ONE iteration from the stored pattern (not full recorded history)
        const iteration = this.extractPatternIteration(navPattern);
        const sequenceLength = iteration.length;

        // Look for repeated URL sequences
        let matches = 0;
        const recentNavs = this.sessionActions
          .filter((a) => a.type === "navigation")
          .slice(-20); // Last 20 navigation actions

        // Create a minimal pattern with just the iteration for matching
        const iterationPattern: NavigationPattern = {
          sequence: iteration,
          sessionGap: navPattern.sessionGap,
        };

        for (let i = 0; i < recentNavs.length - sequenceLength + 1; i++) {
          const slice = recentNavs.slice(i, i + sequenceLength);
          if (this.matchesNavigationPattern(slice, iterationPattern)) {
            matches++;
          }
        }

        return matches;
      } else if (pattern.type === "form") {
        // Count form submissions matching this pattern
        const formPattern = patternData as FormPattern;
        const recentForms = this.sessionActions
          .filter((a) => a.type === "form")
          .slice(-10); // Last 10 form submissions

        let matches = 0;
        for (const action of recentForms) {
          if (this.matchesFormPattern(action.data, formPattern)) {
            matches++;
          }
        }

        return matches;
      } else if (pattern.type === "copy-paste") {
        // Count copy-paste pairs matching this pattern
        const copyPastePattern = patternData as CopyPastePattern;
        const recentCopyPastes = this.sessionActions
          .filter((a) => a.type === "copy-paste")
          .slice(-10); // Last 10 copy-paste actions

        let matches = 0;
        for (const action of recentCopyPastes) {
          if (this.matchesCopyPastePattern(action.data, copyPastePattern)) {
            matches++;
          }
        }

        return matches;
      }

      return 0;
    } catch (error) {
      log.error("[PatternRecognizer] Error counting matches:", error);
      return 0;
    }
  }

  /**
   * Check if a sequence of session actions matches a navigation pattern
   */
  private matchesNavigationPattern(
    actions: Array<{ type: string; data: unknown; timestamp: number }>,
    pattern: NavigationPattern,
  ): boolean {
    if (actions.length !== pattern.sequence.length) {
      return false;
    }

    for (let i = 0; i < actions.length; i++) {
      const actionData = actions[i].data as { url?: string };
      const patternUrl = pattern.sequence[i].url;

      // Simple URL domain comparison (ignore query params)
      try {
        const actionDomain = actionData.url
          ? new URL(actionData.url).hostname
          : "";
        const patternDomain = new URL(patternUrl).hostname;

        if (actionDomain !== patternDomain) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a form submission matches a form pattern
   */
  private matchesFormPattern(
    actionData: unknown,
    pattern: FormPattern,
  ): boolean {
    try {
      const formData = actionData as { domain?: string; formSelector?: string };

      return (
        formData.domain === pattern.domain &&
        formData.formSelector === pattern.formSelector
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if a copy-paste action matches a copy-paste pattern
   */
  private matchesCopyPastePattern(
    actionData: unknown,
    pattern: CopyPastePattern,
  ): boolean {
    try {
      const cpData = actionData as {
        sourceUrl?: string;
        destinationUrl?: string;
        sourceElement?: string;
        destinationElement?: string;
      };

      // Pattern has array of pairs, check if action matches any pair
      if (!pattern.pairs || pattern.pairs.length === 0) {
        return false;
      }

      // Compare against first pair (representative of the pattern)
      const firstPair = pattern.pairs[0];

      // Compare source and destination URLs by hostname
      try {
        const actionSourceHost = cpData.sourceUrl
          ? new URL(cpData.sourceUrl).hostname
          : "";
        const actionDestHost = cpData.destinationUrl
          ? new URL(cpData.destinationUrl).hostname
          : "";
        const patternSourceHost = new URL(firstPair.sourceUrl).hostname;
        const patternDestHost = new URL(firstPair.destinationUrl).hostname;

        return (
          actionSourceHost === patternSourceHost &&
          actionDestHost === patternDestHost &&
          cpData.sourceElement === firstPair.sourceElement &&
          cpData.destinationElement === firstPair.destinationElement
        );
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Estimate how many more items user might want to process
   * Simple heuristic: Default to 5-10 items based on pattern type
   */
  private estimateRemainingItems(pattern: PatternRow): number {
    // Navigation patterns: Default to 5 more pages
    if (pattern.type === "navigation") {
      return 5;
    }

    // Form patterns: Default to 3 more forms
    if (pattern.type === "form") {
      return 3;
    }

    return 5; // Default fallback
  }

  /**
   * Generate a template-based intent summary for patterns without AI summaries
   * Fallback when intent_summary is not available
   */
  private generateTemplateSummary(
    patternType: PatternType,
    patternData: NavigationPattern | FormPattern,
  ): string {
    try {
      if (patternType === "navigation") {
        const navPattern = patternData as NavigationPattern;
        const domains = navPattern.sequence
          .map((s) => {
            try {
              return new URL(s.url).hostname;
            } catch {
              return "unknown site";
            }
          })
          .filter((d, i, arr) => arr.indexOf(d) === i); // unique domains

        if (domains.length === 1) {
          return `navigating through ${domains[0]}`;
        } else if (domains.length === 2) {
          return `navigating between ${domains[0]} and ${domains[1]}`;
        } else {
          return `navigating across ${domains.length} different sites`;
        }
      } else if (patternType === "form") {
        const formPattern = patternData as FormPattern;
        const domain = formPattern.domain;
        const fieldCount = formPattern.fields.length;

        return `filling out forms on ${domain} with ${fieldCount} field${fieldCount > 1 ? "s" : ""}`;
      } else if (patternType === "copy-paste") {
        // Copy-paste pattern
        return `copying and pasting content between pages`;
      }

      return "performing a repeated workflow";
    } catch (error) {
      log.error(
        "[PatternRecognizer] Error generating template summary:",
        error,
      );
      return "performing a repeated workflow";
    }
  }

  /**
   * Get Window instance (for sidebar access in mid-workflow detection)
   * This is set by the Window class during initialization
   */
  private window!: import("./Window").Window;

  public setWindow(window: import("./Window").Window): void {
    this.window = window;
  }
}
