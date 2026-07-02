import { useState, useCallback } from "react";

export function useExclusiveSectionOpen(initialOpenSections) {
  const [open, setOpen] = useState(initialOpenSections);
  const toggleSection = useCallback((key) => {
    setOpen((s) => {
      const isOpening = !s[key];
      if (isOpening) {
        return Object.fromEntries(Object.keys(s).map(k => [k, k === key]));
      }
      return { ...s, [key]: false };
    });
  }, []);

  return { open, toggleSection };
}
