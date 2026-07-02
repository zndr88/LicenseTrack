import { useRef, useEffect } from "react";

export function useNavigationGuard({ anyDirty, navGuard, onBlockedNavigate }) {
  const anyDirtyRef = useRef(anyDirty);
  useEffect(() => { anyDirtyRef.current = anyDirty; }, [anyDirty]);

  useEffect(() => {
    navGuard?.registerNavGuard?.((targetPage) => {
      if (anyDirtyRef.current) {
        onBlockedNavigate(targetPage);
      } else {
        navGuard?.navigate?.(targetPage);
      }
    });
    return () => navGuard?.registerNavGuard?.(null);
  }, [navGuard, onBlockedNavigate]);
}
