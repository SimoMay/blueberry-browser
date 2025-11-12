import { ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

interface PanelProps {
  /** Panel title displayed in the header */
  title: string;
  /** Whether the panel should be expanded by default */
  defaultExpanded?: boolean;
  /** Panel content */
  children: React.ReactNode;
  /** Optional action buttons displayed in the header */
  actions?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Panel component with collapsible header and scrollable content
 * Used for sidebar sections and content organization
 */
export const Panel: React.FC<PanelProps> = ({
  title,
  defaultExpanded = true,
  children,
  actions,
  className = "",
}) => {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  return (
    <div
      className={`border border-gray-200 dark:border-gray-700 rounded-lg ${className}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="flex items-center gap-2">
          {actions && (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          )}
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-3 pt-0 max-h-96 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          <div className="pt-3 text-gray-700 dark:text-gray-300">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};
