import React from "react";

interface BadgeProps {
  count: number;
  severity?: "info" | "warning" | "error";
  pulse?: boolean;
  className?: string;
}

/**
 * Badge component with count indicator and optional pulse animation
 * Used for displaying notification counts
 */
export const Badge: React.FC<BadgeProps> = ({
  count,
  severity = "info",
  pulse = false,
  className = "",
}) => {
  if (count === 0) {
    return null;
  }

  // Severity color classes
  const severityClasses = {
    info: "bg-blue-500 dark:bg-blue-600",
    warning: "bg-yellow-500 dark:bg-yellow-600",
    error: "bg-red-500 dark:bg-red-600",
  };

  const badgeClasses = `
    inline-flex items-center justify-center
    min-w-5 h-5 px-1.5
    text-xs font-semibold text-white
    rounded-full
    ${severityClasses[severity]}
    ${pulse ? "animate-pulse-badge" : ""}
    ${className}
  `.trim();

  // Display 99+ for counts over 99
  const displayCount = count > 99 ? "99+" : count;

  return <span className={badgeClasses}>{displayCount}</span>;
};

/**
 * Add pulse animation to Tailwind config or use inline styles
 * This component uses the animate-pulse-badge class which should be
 * defined in the Tailwind config or CSS:
 *
 * @keyframes pulse-badge {
 *   0%, 100% { opacity: 1; }
 *   50% { opacity: 0.5; }
 * }
 *
 * .animate-pulse-badge {
 *   animation: pulse-badge 2s ease-in-out infinite;
 * }
 */
