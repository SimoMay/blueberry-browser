import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useMemo,
} from "react";

/**
 * Automation interface (matches backend response)
 */
export interface Automation {
  id: string;
  patternId: string;
  name: string;
  description?: string;
  patternData: {
    sequence?: Array<{ url: string; timestamp: number; tabId: string }>;
    domain?: string;
    formSelector?: string;
    fields?: Array<{ name: string; valuePattern: string }>;
    pairs?: Array<{ sourceUrl: string; destinationUrl: string }>;
    steps?: Array<{
      tab?: number;
      action: string;
      target?: string;
      value?: string;
      url?: string;
    }>;
    [key: string]: unknown; // Allow additional properties for flexibility
  };
  patternType: "navigation" | "form" | "copy-paste";
  executionCount: number;
  lastExecuted?: number;
  createdAt: number;
}

/**
 * Execution progress data
 */
export interface ExecutionProgress {
  automationId: string;
  currentStep: number;
  totalSteps: number;
  stepDescription: string;
  screenshot?: string; // Base64 screenshot thumbnail for progress display
}

/**
 * Automation context value
 */
interface AutomationContextValue {
  automations: Automation[];
  loading: boolean;
  executing: Set<string>; // Set of automation IDs currently executing
  progress: Map<string, ExecutionProgress>; // Map of automation ID to progress
  refining: string | null; // Automation ID currently being refined
  loadAutomations: () => Promise<void>;
  executeAutomation: (automationId: string) => Promise<void>;
  cancelAutomation: () => Promise<void>; // Cancel currently executing automation
  editAutomation: (
    automationId: string,
    name: string,
    description?: string,
  ) => Promise<void>;
  deleteAutomation: (automationId: string) => Promise<void>;
  startRefinement: (automationId: string) => void; // Open refinement dialog
  cancelRefinement: () => void; // Close refinement dialog
}

const AutomationContext = createContext<AutomationContextValue | undefined>(
  undefined,
);

/**
 * AutomationProvider - provides automation state and management to the app
 */
export function AutomationProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Map<string, ExecutionProgress>>(
    new Map(),
  );
  const [refining, setRefining] = useState<string | null>(null);

  /**
   * Load all automations from backend
   */
  const loadAutomations = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.sidebarAPI.automations.getAll();

      if (result.success && result.data) {
        setAutomations(result.data);
      } else {
        console.error(
          "[AutomationContext] Failed to load automations:",
          result.error,
        );
      }
    } catch (error) {
      console.error("[AutomationContext] Load error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Execute an automation
   */
  const executeAutomation = useCallback(
    async (automationId: string) => {
      try {
        // Add to executing set
        setExecuting((prev) => new Set(prev).add(automationId));

        const result =
          await window.sidebarAPI.automations.execute(automationId);

        if (result.success) {
          // Success toast will be shown by onComplete event handler
          await loadAutomations(); // Reload to get updated execution_count
        } else {
          throw new Error(result.error?.message || "Execution failed");
        }
      } catch (error) {
        console.error("[AutomationContext] Execute error:", error);
        // Remove from executing set on error
        setExecuting((prev) => {
          const next = new Set(prev);
          next.delete(automationId);
          return next;
        });
        // Remove progress on error
        setProgress((prev) => {
          const next = new Map(prev);
          next.delete(automationId);
          return next;
        });
      }
    },
    [loadAutomations],
  );

  /**
   * Cancel automation execution
   */
  const cancelAutomation = useCallback(async () => {
    try {
      const result = await window.sidebarAPI.automations.cancel();

      if (result.success) {
        console.log("[AutomationContext] Automation cancelled successfully");
        // The onComplete handler will clean up executing and progress state
      } else {
        throw new Error(result.error?.message || "Cancel failed");
      }
    } catch (error) {
      console.error("[AutomationContext] Cancel error:", error);
      throw error; // Re-throw so UI can handle it
    }
  }, []);

  /**
   * Edit automation name and description
   */
  const editAutomation = useCallback(
    async (automationId: string, name: string, description?: string) => {
      try {
        const result = await window.sidebarAPI.automations.edit({
          automationId,
          name,
          description,
        });

        if (result.success) {
          console.log("[AutomationContext] Automation updated successfully");
          await loadAutomations();
        } else {
          throw new Error(result.error?.message || "Edit failed");
        }
      } catch (error) {
        console.error("[AutomationContext] Edit error:", error);
        throw error; // Re-throw so UI can handle it
      }
    },
    [loadAutomations],
  );

  /**
   * Delete automation
   */
  const deleteAutomation = useCallback(async (automationId: string) => {
    try {
      const result = await window.sidebarAPI.automations.delete(automationId);

      if (result.success) {
        console.log("[AutomationContext] Automation deleted successfully");
        // Remove from local state immediately for better UX
        setAutomations((prev) => prev.filter((a) => a.id !== automationId));
      } else {
        throw new Error(result.error?.message || "Delete failed");
      }
    } catch (error) {
      console.error("[AutomationContext] Delete error:", error);
      throw error; // Re-throw so UI can handle it
    }
  }, []);

  /**
   * Start workflow refinement (Story 1.17)
   */
  const startRefinement = useCallback((automationId: string) => {
    setRefining(automationId);
  }, []);

  /**
   * Cancel workflow refinement (Story 1.17)
   */
  const cancelRefinement = useCallback(() => {
    setRefining(null);
  }, []);

  /**
   * Set up IPC event listeners for execution progress and completion
   */
  useEffect(() => {
    // Progress event handler
    const handleProgress = (data: ExecutionProgress): void => {
      console.log("[AutomationContext] Execution progress:", data);
      // Update progress map for this automation
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.automationId, data);
        return next;
      });
    };

    // Completion event handler
    const handleComplete = (data: {
      automationId: string;
      success: boolean;
      stepsExecuted: number;
      error?: string;
    }): void => {
      console.log("[AutomationContext] Execution complete:", data);

      if (data.success) {
        console.log(
          `[AutomationContext] Automation completed successfully (${data.stepsExecuted} steps)`,
        );
      } else {
        console.error(
          "[AutomationContext] Automation execution failed:",
          data.error,
        );
      }

      // Remove from executing set
      setExecuting((prev) => {
        const next = new Set(prev);
        next.delete(data.automationId);
        return next;
      });

      // Remove from progress map
      setProgress((prev) => {
        const next = new Map(prev);
        next.delete(data.automationId);
        return next;
      });

      loadAutomations(); // Reload to get updated counts
    };

    // Register event listeners
    window.sidebarAPI.automations.onProgress(handleProgress);
    window.sidebarAPI.automations.onComplete(handleComplete);

    // Cleanup on unmount
    return () => {
      window.sidebarAPI.automations.removeProgressListener();
      window.sidebarAPI.automations.removeCompleteListener();
    };
  }, [loadAutomations]);

  /**
   * Load automations on mount
   */
  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  // Memoize context value to prevent unnecessary re-renders (AC-7)
  const value = useMemo(
    () => ({
      automations,
      loading,
      executing,
      progress,
      refining,
      loadAutomations,
      executeAutomation,
      cancelAutomation,
      editAutomation,
      deleteAutomation,
      startRefinement,
      cancelRefinement,
    }),
    [
      automations,
      loading,
      executing,
      progress,
      refining,
      loadAutomations,
      executeAutomation,
      cancelAutomation,
      editAutomation,
      deleteAutomation,
      startRefinement,
      cancelRefinement,
    ],
  );

  return (
    <AutomationContext.Provider value={value}>
      {children}
    </AutomationContext.Provider>
  );
}

/**
 * useAutomation hook - access automation context
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAutomation(): AutomationContextValue {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error("useAutomation must be used within AutomationProvider");
  }
  return context;
}
