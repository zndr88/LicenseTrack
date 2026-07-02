import { useState, useCallback, useRef } from "react";

/**
 * Tracks whether a form has unsaved changes by comparing
 * current values against the initial snapshot.
 *
 * Usage:
 *   const { isDirty, setInitial, check, reset } = useDirtyForm();
 *
 *   // On modal open: setInitial(formValues)
 *   // On any field change: check(currentFormValues)
 *   // On save or cancel confirmed: reset()
 */
export function useDirtyForm() {
  const initialRef = useRef(null);
  const [isDirty, setIsDirty] = useState(false);

  const setInitial = useCallback((values) => {
    initialRef.current = JSON.stringify(values);
    setIsDirty(false);
  }, []);

  const check = useCallback((currentValues) => {
    if (initialRef.current === null) return;
    const changed = JSON.stringify(currentValues) !== initialRef.current;
    setIsDirty(changed);
  }, []);

  const reset = useCallback(() => {
    initialRef.current = null;
    setIsDirty(false);
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  return { isDirty, setInitial, check, reset, markDirty };
}
