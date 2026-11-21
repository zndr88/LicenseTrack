import { useEffect } from "react";

// While `active`, the browser asks for confirmation before the tab is closed
// or reloaded. Browsers show their own wording for this prompt.
export function useBeforeUnloadWarning(active) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
