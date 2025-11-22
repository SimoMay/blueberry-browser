import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface WorkflowDisplayProps {
  workflow: Record<string, unknown> | null | undefined;
  title?: string;
  collapsible?: boolean;
}

/**
 * WorkflowDisplay - Displays workflow data in a formatted, readable way
 *
 * Shows workflow steps, actions, and configuration in a structured format.
 * Can be collapsed/expanded if collapsible prop is true.
 */
export const WorkflowDisplay: React.FC<WorkflowDisplayProps> = ({
  workflow,
  title = "Workflow",
  collapsible = true,
}) => {
  // If not collapsible, always show expanded
  const [isExpanded, setIsExpanded] = React.useState(!collapsible);

  if (!workflow) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 italic">
        No workflow data available
      </div>
    );
  }

  // Format workflow for display
  const formatWorkflow = (data: Record<string, unknown>): React.JSX.Element => {
    // Check if it has steps array (LLM-decided format)
    if (Array.isArray(data.steps) && data.steps.length > 0) {
      return (
        <div className="space-y-2">
          {data.steps.map((step: Record<string, unknown>, index: number) => (
            <div
              key={index}
              className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900 rounded-full flex-shrink-0">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {String(step.action || "Unknown action")}
                  </div>
                  {Boolean(step.target) && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Target: {String(step.target)}
                    </div>
                  )}
                  {Boolean(step.value) && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Value: {String(step.value)}
                    </div>
                  )}
                  {Boolean(step.url) && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">
                      URL: {String(step.url)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Fallback: Display as JSON-like structure
    return (
      <div className="space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div
            key={key}
            className="text-xs font-mono text-gray-700 dark:text-gray-300"
          >
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {key}:
            </span>{" "}
            {typeof value === "object" && value !== null
              ? JSON.stringify(value, null, 2)
              : String(value)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => collapsible && setIsExpanded(!isExpanded)}
        className={`w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 flex items-center justify-between ${
          collapsible
            ? "hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
            : "cursor-default"
        }`}
      >
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {title}
        </span>
        {collapsible &&
          (isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          ))}
      </button>

      {/* Content */}
      {(!collapsible || isExpanded) && (
        <div className="p-3 bg-white dark:bg-gray-900 max-h-60 overflow-y-auto">
          {formatWorkflow(workflow)}
        </div>
      )}
    </div>
  );
};
