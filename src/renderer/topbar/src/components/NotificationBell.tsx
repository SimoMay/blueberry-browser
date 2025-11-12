import React, { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { ToolBarButton } from "./ToolBarButton";

export const NotificationBell: React.FC = () => {
  const [count, setCount] = useState(0);

  // Fetch notification count on mount and periodically
  useEffect(() => {
    const fetchCount = async (): Promise<void> => {
      try {
        const response = await window.topBarAPI.getNotificationCount();
        if (response.success && typeof response.data === "number") {
          setCount(response.data);
        }
      } catch (error) {
        console.error("Failed to fetch notification count:", error);
      }
    };

    // Initial fetch
    fetchCount();

    // Poll every 5 seconds
    const interval = setInterval(fetchCount, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleClick = (): void => {
    window.topBarAPI.showNotifications();
  };

  return (
    <div className="relative">
      <ToolBarButton Icon={Bell} onClick={handleClick} />
      {count > 0 && (
        <div className="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center bg-blue-500 text-white text-[9px] font-semibold rounded-full animate-pulse-badge">
          {count > 99 ? "99+" : count}
        </div>
      )}
    </div>
  );
};
