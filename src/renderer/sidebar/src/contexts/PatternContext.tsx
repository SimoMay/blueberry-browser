import React, {
  createContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useMemo,
} from "react";
import { Notification } from "./notificationTypes";

/**
 * Pattern detected by PatternRecognizer
 * Updated Story 1.19: Added LLM summary fields and workflow steps
 */
export interface Pattern {
  id: string;
  type: "navigation" | "form" | "copy-paste";
  patternData: {
    sequence?: Array<{ url: string; title?: string }>;
    domain?: string;
    fields?: Array<{ name: string; type?: string }>;
    steps?: Array<Record<string, unknown>>; // Story 1.19: LLM-generated workflow steps
  };
  confidence: number;
  occurrenceCount: number;
  firstSeen?: number;
  lastSeen?: number;
  intentSummary?: string; // Story 1.19: LLM-generated short summary
  intentSummaryDetailed?: string; // Story 1.19: LLM-generated detailed summary
}

/**
 * Pattern context value
 */
export interface PatternContextValue {
  patterns: Pattern[];
  unacknowledgedCount: number;
  dismissPattern: (patternId: string) => Promise<void>;
  saveAutomation: (
    patternId: string,
    name: string,
    description?: string,
  ) => Promise<string>;
  clearAcknowledged: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const PatternContext = createContext<PatternContextValue | undefined>(
  undefined,
);

interface PatternProviderProps {
  children: ReactNode;
}

export const PatternProvider: React.FC<PatternProviderProps> = ({
  children,
}) => {
  const [patterns, setPatterns] = useState<Pattern[]>([]);

  /**
   * Type guard to check if notification data is pattern data
   */
  function isPatternData(data: unknown): data is {
    id: string;
    type: "navigation" | "form" | "copy-paste";
    confidence: number;
    occurrenceCount: number;
    firstSeen?: number;
    lastSeen?: number;
    patternData: unknown;
    intentSummary?: string; // Story 1.19
    intentSummaryDetailed?: string; // Story 1.19
  } {
    return (
      typeof data === "object" &&
      data !== null &&
      "id" in data &&
      "type" in data &&
      "patternData" in data
    );
  }

  /**
   * Handle incoming pattern notifications from main process
   */
  const handleNotification = useCallback(
    (notification: Notification): void => {
      // Only process pattern-type notifications
      if (notification.type !== "pattern") {
        return;
      }

      // Parse data if it's a JSON string
      let parsedData = notification.data;
      if (typeof notification.data === "string") {
        try {
          parsedData = JSON.parse(notification.data);
        } catch (error) {
          console.error(
            "[PatternContext] Failed to parse live notification data:",
            error,
          );
          return;
        }
      }

      if (!isPatternData(parsedData)) {
        return;
      }

      const data = parsedData;
      const patternExists = patterns.some((p) => p.id === data.id);

      if (!patternExists) {
        setPatterns((prev) => [
          ...prev,
          {
            id: data.id,
            type: data.type,
            patternData: data.patternData as Pattern["patternData"],
            confidence: data.confidence,
            occurrenceCount: data.occurrenceCount,
            firstSeen: data.firstSeen,
            lastSeen: data.lastSeen,
          },
        ]);
      }
    },
    [patterns],
  );

  /**
   * Fetch existing pattern notifications on mount
   */
  useEffect(() => {
    const loadExistingPatterns = async (): Promise<void> => {
      try {
        const response =
          await window.sidebarAPI.notifications.getAll("pattern");

        if (response.success && response.data) {
          // Process existing pattern notifications
          const existingPatterns: Pattern[] = [];

          response.data.forEach((notification) => {
            if (notification.dismissed_at !== null) {
              return;
            }

            // Parse data if it's a JSON string
            let parsedData = notification.data;
            if (typeof notification.data === "string") {
              try {
                parsedData = JSON.parse(notification.data);
              } catch (error) {
                console.error(
                  "[PatternContext] Failed to parse notification data:",
                  error,
                );
                return;
              }
            }

            if (isPatternData(parsedData)) {
              const data = parsedData;
              existingPatterns.push({
                id: data.id,
                type: data.type,
                patternData: data.patternData as Pattern["patternData"],
                confidence: data.confidence,
                occurrenceCount: data.occurrenceCount,
                firstSeen: data.firstSeen,
                lastSeen: data.lastSeen,
              });
            }
          });

          if (existingPatterns.length > 0) {
            setPatterns(existingPatterns);
          }
        }
      } catch (error) {
        console.error(
          "[PatternContext] Failed to load existing patterns:",
          error,
        );
      }
    };

    loadExistingPatterns();
  }, []); // Only run on mount

  /**
   * Listen for pattern notifications from main process
   */
  useEffect(() => {
    // Subscribe to notification events (reuse existing notification channel)
    window.sidebarAPI.notifications.onReceive(handleNotification);

    return () => {
      window.sidebarAPI.notifications.removeReceiveListener();
    };
  }, [handleNotification]);

  /**
   * Dismiss a pattern permanently
   * @param patternId Pattern ID to dismiss
   */
  const dismissPattern = useCallback(async (patternId: string) => {
    try {
      const response = await window.sidebarAPI.pattern.dismiss({
        patternId,
      });

      if (response.success) {
        // Remove from patterns list
        setPatterns((prev) => prev.filter((p) => p.id !== patternId));
      } else {
        throw new Error(response.error?.message || "Failed to dismiss pattern");
      }
    } catch (error) {
      console.error("[PatternContext] Dismiss error:", error);
      throw error;
    }
  }, []);

  /**
   * Save pattern as automation
   * @param patternId Pattern ID to convert
   * @param name Automation name
   * @param description Optional automation description
   * @returns Automation ID
   */
  const saveAutomation = useCallback(
    async (
      patternId: string,
      name: string,
      description?: string,
    ): Promise<string> => {
      try {
        const response = await window.sidebarAPI.pattern.saveAutomation({
          pattern_id: patternId,
          name,
          description,
        });

        if (response.success && response.data) {
          // Remove from patterns list after successful conversion
          setPatterns((prev) => prev.filter((p) => p.id !== patternId));
          return response.data.id;
        } else {
          throw new Error(
            response.error?.message || "Failed to save automation",
          );
        }
      } catch (error) {
        console.error("[PatternContext] Save automation error:", error);
        throw error;
      }
    },
    [],
  );

  /**
   * Clear all acknowledged patterns
   */
  const clearAcknowledged = useCallback(() => {
    setPatterns([]);
  }, []);

  // Memoize context value to prevent unnecessary re-renders (AC-7)
  const value: PatternContextValue = useMemo(
    () => ({
      patterns,
      unacknowledgedCount: patterns.length,
      dismissPattern,
      saveAutomation,
      clearAcknowledged,
    }),
    [patterns, dismissPattern, saveAutomation, clearAcknowledged],
  );

  return (
    <PatternContext.Provider value={value}>{children}</PatternContext.Provider>
  );
};
