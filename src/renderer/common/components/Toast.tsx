import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import * as React from "react";

interface ToastProps {
  /** Toast type determines icon and styling */
  type: "info" | "success" | "warning" | "error";
  /** Toast message content */
  message: string;
  /** Auto-dismiss duration in milliseconds (default: 3000ms) */
  duration?: number;
  /** Callback fired when toast should be closed */
  onClose: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Toast component for temporary alert notifications
 * Auto-dismisses after specified duration with slide-in animation
 */
export const Toast: React.FC<ToastProps> = ({
  type,
  message,
  duration = 3000,
  onClose,
  className = "",
}) => {
  // Auto-dismiss timer
  React.useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  // Type-specific styling and icons
  const typeStyles = {
    info: {
      container:
        "bg-blue-50 border-blue-200 dark:bg-blue-900/90 dark:border-blue-700",
      icon: "text-blue-500 dark:text-blue-300",
      text: "text-blue-900 dark:text-blue-50",
      IconComponent: Info,
    },
    success: {
      container:
        "bg-green-50 border-green-200 dark:bg-green-900/90 dark:border-green-700",
      icon: "text-green-500 dark:text-green-300",
      text: "text-green-900 dark:text-green-50",
      IconComponent: CheckCircle,
    },
    warning: {
      container:
        "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/90 dark:border-yellow-700",
      icon: "text-yellow-500 dark:text-yellow-300",
      text: "text-yellow-900 dark:text-yellow-50",
      IconComponent: AlertTriangle,
    },
    error: {
      container:
        "bg-red-50 border-red-200 dark:bg-red-900/90 dark:border-red-700",
      icon: "text-red-500 dark:text-red-300",
      text: "text-red-900 dark:text-red-50",
      IconComponent: AlertCircle,
    },
  };

  const style = typeStyles[type];
  const IconComponent = style.IconComponent;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slide-in ${style.container} ${className}`}
      role="alert"
    >
      <IconComponent className={`w-5 h-5 flex-shrink-0 ${style.icon}`} />
      <p className={`flex-1 text-sm font-medium ${style.text}`}>{message}</p>
      <button
        onClick={onClose}
        className={`flex-shrink-0 ${style.icon} hover:opacity-70 transition-opacity`}
        aria-label="Close toast"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * ToastContainer component for managing multiple toasts
 * Stacks toasts vertically at top-right of screen
 */
interface ToastContainerProps {
  /** Array of toast configurations */
  toasts: Array<{
    id: string;
    type: "info" | "success" | "warning" | "error";
    message: string;
    duration?: number;
  }>;
  /** Callback to remove a toast by ID */
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onRemove,
}) => {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
};
