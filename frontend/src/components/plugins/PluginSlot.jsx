import { useEffect, useRef, useState } from "react";
import { invokePluginAction, listPluginActions } from "../../api/pluginActions.js";
import Icon from "../ui/Icon.jsx";

export default function PluginSlot({ slot, context, onResult, onActionsLoaded }) {
  const [actions, setActions] = useState([]);
  const [busyKey, setBusyKey] = useState(null);
  const [result, setResult] = useState(null);
  const onActionsLoadedRef = useRef(onActionsLoaded);

  useEffect(() => {
    onActionsLoadedRef.current = onActionsLoaded;
  }, [onActionsLoaded]);

  useEffect(() => {
    let cancelled = false;
    setActions([]);
    setResult(null);
    onActionsLoadedRef.current?.(0);
    if (!slot || !context?.targetType || context?.targetId == null) return undefined;
    listPluginActions({
      slot,
      targetType: context.targetType,
      targetId: context.targetId,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.warn("[PluginSlot] Failed to load plugin actions:", error);
        return;
      }
      const loaded = data?.actions ?? [];
      setActions(loaded);
      onActionsLoadedRef.current?.(loaded.length);
    });
    return () => {
      cancelled = true;
    };
  }, [slot, context?.targetType, context?.targetId]);

  if (!actions.length) return null;

  const invoke = async (action) => {
    const key = action.key || `${action.pluginKey}:${action.actionKey}`;
    setBusyKey(key);
    setResult({ type: "loading", text: `${action.label} in progress...` });
    const { data, error } = await invokePluginAction(action.pluginKey, action.actionKey, {
      targetType: context.targetType,
      targetId: String(context.targetId),
      context,
    });
    setBusyKey(null);
    if (error) {
      setResult({ type: "error", text: `${action.label} failed: ${error}` });
      return;
    }
    if ((data?.suggestionsCreated ?? 0) > 0) {
      window.dispatchEvent(new window.CustomEvent("plugin-suggestions:changed", {
        detail: { licenseId: context.licenseId, suggestionsCreated: data.suggestionsCreated },
      }));
    }
    onResult?.(data, action);
    setResult({
      type: "success",
      text: data?.suggestionsCreated
        ? `${data.suggestionsCreated} suggestion${data.suggestionsCreated === 1 ? "" : "s"} created.`
        : data?.summary || `${action.label} finished.`,
    });
  };

  return (
    <>
      {actions.map((action) => {
        const key = action.key || `${action.pluginKey}:${action.actionKey}`;
        const isBusy = busyKey === key;
        return (
          <button
            key={key}
            className="doc-action-btn plugin"
            title={action.description || `${action.pluginName}: ${action.label}`}
            aria-label={action.label}
            disabled={!!busyKey}
            onClick={() => invoke(action)}
          >
            <Icon name={isBusy ? "clock" : action.icon || "activity"} size={14} />
            <span className="plugin-action-label">{action.label}</span>
          </button>
        );
      })}
      {result && (
        <span className={`plugin-slot-inline-status ${result.type}`} role="status" aria-live="polite">
          {result.type === "loading" && (
            <span className="plugin-slot-spinner" aria-hidden="true" />
          )}
          {result.text}
        </span>
      )}
    </>
  );
}
