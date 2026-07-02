import { useState, useEffect, useCallback } from "react";

export function useDirtySections() {
  const [dirtySection, setDirtySection] = useState({});
  const markDirty = useCallback((section) => {
    setDirtySection(prev => ({ ...prev, [section]: true }));
  }, []);
  const clearDirty = useCallback((section) => {
    setDirtySection(prev => ({ ...prev, [section]: false }));
  }, []);
  const anyDirty = Object.values(dirtySection).some(Boolean);

  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  return { dirtySection, setDirtySection, markDirty, clearDirty, anyDirty };
}
