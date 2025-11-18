import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  type JSX,
} from "react";

interface RecordingState {
  isRecording: boolean;
  tabId: string | null;
  actionCount: number;
  status: "active" | "paused" | "stopped" | "timeout" | "error";
}

interface RecordedAction {
  type: "navigation" | "form" | "click";
  timestamp: number;
  data: unknown;
}

interface RecordingPreviewData {
  actions: RecordedAction[];
  tabId: string;
  duration: number;
}

interface RecordingContextValue {
  recording: RecordingState;
  startRecording: (tabId: string) => Promise<void>;
  stopRecording: () => Promise<RecordingPreviewData | null>;
  saveRecording: (
    name: string,
    description: string | undefined,
    actions: RecordedAction[],
  ) => Promise<string>;
  discardRecording: () => void;
}

const RecordingContext = createContext<RecordingContextValue | undefined>(
  undefined,
);

export function RecordingProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [recording, setRecording] = useState<RecordingState>({
    isRecording: false,
    tabId: null,
    actionCount: 0,
    status: "stopped",
  });

  const startRecording = useCallback(async (tabId: string) => {
    try {
      const result = await window.sidebarAPI.recording.start(tabId);

      if (result.success) {
        setRecording({
          isRecording: true,
          tabId,
          actionCount: 0,
          status: "active",
        });
      } else {
        // Throw the full result object so AutomationLibrary can check error.code
        throw result;
      }
    } catch (error) {
      console.error("[RecordingContext] Start error:", error);
      throw error;
    }
  }, []);

  const stopRecording =
    useCallback(async (): Promise<RecordingPreviewData | null> => {
      try {
        const result = await window.sidebarAPI.recording.stop();

        if (result.success && result.data) {
          setRecording({
            isRecording: false,
            tabId: null,
            actionCount: 0,
            status: "stopped",
          });

          return result.data as RecordingPreviewData;
        } else {
          throw new Error(result.error?.message || "Failed to stop recording");
        }
      } catch (error) {
        console.error("[RecordingContext] Stop error:", error);
        throw error;
      }
    }, []);

  const saveRecording = useCallback(
    async (
      name: string,
      description: string | undefined,
      actions: RecordedAction[],
    ): Promise<string> => {
      try {
        const result = await window.sidebarAPI.recording.save({
          name,
          description,
          actions,
        });

        if (result.success && result.data) {
          return result.data.automationId;
        } else {
          throw new Error(result.error?.message || "Failed to save recording");
        }
      } catch (error) {
        console.error("[RecordingContext] Save error:", error);
        throw error;
      }
    },
    [],
  );

  const discardRecording = useCallback((): void => {
    setRecording({
      isRecording: false,
      tabId: null,
      actionCount: 0,
      status: "stopped",
    });
  }, []);

  useEffect((): (() => void) => {
    // Listen for action captured events
    const handleActionCaptured = (data: {
      tabId: string;
      actionCount: number;
      actionType: string;
    }): void => {
      setRecording((prev) => ({
        ...prev,
        actionCount: data.actionCount,
      }));
    };

    // Listen for status changed events
    const handleStatusChanged = (data: {
      status: string;
      tabId?: string;
      message?: string;
    }): void => {
      setRecording((prev) => ({
        ...prev,
        status: data.status as RecordingState["status"],
      }));
    };

    window.sidebarAPI.recording.on(
      "action-captured",
      handleActionCaptured as (data: unknown) => void,
    );
    window.sidebarAPI.recording.on(
      "status-changed",
      handleStatusChanged as (data: unknown) => void,
    );

    return () => {
      window.sidebarAPI.recording.removeListener("action-captured");
      window.sidebarAPI.recording.removeListener("status-changed");
    };
  }, []);

  return (
    <RecordingContext.Provider
      value={{
        recording,
        startRecording,
        stopRecording,
        saveRecording,
        discardRecording,
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecording(): RecordingContextValue {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error("useRecording must be used within RecordingProvider");
  }
  return context;
}
