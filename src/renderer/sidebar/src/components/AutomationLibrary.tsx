import React, { useEffect } from "react";
import { MessageSquare, Zap, Loader2 } from "lucide-react";
import { useAutomation } from "../contexts/AutomationContext";
import { AutomationItem } from "./AutomationItem";
import { Button } from "@common/components/Button";

interface AutomationLibraryProps {
  onBackToChat?: () => void;
}

/**
 * AutomationLibrary component - displays all saved automations
 */
export const AutomationLibrary: React.FC<AutomationLibraryProps> = ({
  onBackToChat,
}) => {
  const {
    automations,
    loading,
    executing,
    progress,
    loadAutomations,
    executeAutomation,
    editAutomation,
    deleteAutomation,
  } = useAutomation();

  // Refresh automations when component mounts/becomes visible
  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Automation Library
            </h2>
          </div>
          {onBackToChat && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBackToChat}
              className="flex items-center gap-1"
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          {automations.length === 0
            ? "No automations saved yet"
            : `${automations.length} ${automations.length === 1 ? "automation" : "automations"}`}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p className="text-sm">Loading automations...</p>
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-4 mb-4">
              <Zap className="h-8 w-8 text-gray-400 dark:text-gray-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              No Automations Yet
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 max-w-xs mb-4">
              Browse the web to detect patterns, then save them as automations
              to replay later.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Patterns appear in notifications when detected.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((automation) => (
              <AutomationItem
                key={automation.id}
                automation={automation}
                executing={executing.has(automation.id)}
                progress={progress.get(automation.id) || null}
                onExecute={executeAutomation}
                onEdit={editAutomation}
                onDelete={deleteAutomation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
