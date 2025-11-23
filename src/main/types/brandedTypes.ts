/**
 * Branded Types for Domain IDs
 *
 * Provides compile-time type safety for domain IDs to prevent mixing
 * incompatible ID types (e.g., passing PatternId where AutomationId expected).
 *
 * These types are zero-cost abstractions - they compile away to plain strings
 * at runtime, so there's no performance penalty.
 *
 * @see AC-6 from Story 1.22 (Code Quality Implementation)
 */

/**
 * Brand symbol used to create unique nominal types.
 * TypeScript's structural typing means `string & { __brand: "TabId" }` is
 * incompatible with `string & { __brand: "PatternId" }` even though both
 * are structurally just strings with a brand property.
 */
declare const __brand: unique symbol;

/**
 * Base branded type for all IDs
 */
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

/**
 * Tab identifier - uniquely identifies a browser tab
 */
export type TabId = Brand<string, "TabId">;

/**
 * Pattern identifier - uniquely identifies a detected user pattern
 */
export type PatternId = Brand<string, "PatternId">;

/**
 * Automation identifier - uniquely identifies a saved automation
 */
export type AutomationId = Brand<string, "AutomationId">;

/**
 * Notification identifier - uniquely identifies a notification
 */
export type NotificationId = Brand<string, "NotificationId">;

/**
 * Monitor identifier - uniquely identifies a monitor
 */
export type MonitorId = Brand<string, "MonitorId">;

/**
 * Recording session identifier - uniquely identifies a recording session
 */
export type RecordingSessionId = Brand<string, "RecordingSessionId">;

// ============================================================================
// Helper Functions for Creating Branded IDs
// ============================================================================

/**
 * Creates a TabId from a string.
 * Use this when creating new tab IDs or converting existing string IDs.
 *
 * @param id - The string identifier
 * @returns A branded TabId
 *
 * @example
 * const tabId = createTabId(webContents.id.toString());
 */
export function createTabId(id: string): TabId {
  return id as TabId;
}

/**
 * Creates a PatternId from a string.
 *
 * @param id - The string identifier (typically from database)
 * @returns A branded PatternId
 *
 * @example
 * const patternId = createPatternId(crypto.randomUUID());
 */
export function createPatternId(id: string): PatternId {
  return id as PatternId;
}

/**
 * Creates an AutomationId from a string.
 *
 * @param id - The string identifier (typically from database)
 * @returns A branded AutomationId
 *
 * @example
 * const automationId = createAutomationId(savedPattern.id);
 */
export function createAutomationId(id: string): AutomationId {
  return id as AutomationId;
}

/**
 * Creates a NotificationId from a string.
 *
 * @param id - The string identifier (typically from database)
 * @returns A branded NotificationId
 *
 * @example
 * const notificationId = createNotificationId(crypto.randomUUID());
 */
export function createNotificationId(id: string): NotificationId {
  return id as NotificationId;
}

/**
 * Creates a MonitorId from a string.
 *
 * @param id - The string identifier (typically from database)
 * @returns A branded MonitorId
 *
 * @example
 * const monitorId = createMonitorId(crypto.randomUUID());
 */
export function createMonitorId(id: string): MonitorId {
  return id as MonitorId;
}

/**
 * Creates a RecordingSessionId from a string.
 *
 * @param id - The string identifier (typically from crypto.randomUUID())
 * @returns A branded RecordingSessionId
 *
 * @example
 * const sessionId = createRecordingSessionId(crypto.randomUUID());
 */
export function createRecordingSessionId(id: string): RecordingSessionId {
  return id as RecordingSessionId;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Unwraps a branded ID back to a plain string.
 * Useful when passing to APIs that expect string (e.g., database queries).
 *
 * @param id - Any branded ID type
 * @returns The underlying string value
 *
 * @example
 * const tabId: TabId = createTabId("123");
 * db.prepare("SELECT * FROM tabs WHERE id = ?").get(unwrapId(tabId));
 */
export function unwrapId<T extends string>(id: Brand<string, T>): string {
  return id as string;
}

/**
 * Type guard to check if a string is a valid ID format.
 * Can be used for runtime validation before branding.
 *
 * @param value - Value to check
 * @returns True if value is a non-empty string
 *
 * @example
 * if (isValidIdFormat(userInput)) {
 *   const tabId = createTabId(userInput);
 * }
 */
export function isValidIdFormat(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
