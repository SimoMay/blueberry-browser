import { useContext } from "react";
import {
  PatternContext,
  PatternContextValue,
} from "../contexts/PatternContext";

/**
 * Hook to access pattern context
 */
export function usePattern(): PatternContextValue {
  const context = useContext(PatternContext);
  if (!context) {
    throw new Error("usePattern must be used within PatternProvider");
  }
  return context;
}
