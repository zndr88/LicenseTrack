import Icon from "./Icon.jsx";

const TYPES = {
  success: { icon: "check" },
  info: { icon: "check" },
  warning: { icon: "alert" },
  error: { icon: "alert" },
};

/**
 * Shows one message from `useToast`: { msg, type, action }.
 * Inline by default; `floating` pins it to the bottom of the window.
 * Errors are announced immediately to screen readers, other types politely.
 */
export default function MessageBanner({ message, onDismiss, floating = false }) {
  if (!message) return null;
  const type = TYPES[message.type] ? message.type : "info";

  return (
    <div
      className={`msg msg-${type}${floating ? " msg-floating" : ""}`}
      role={type === "error" ? "alert" : "status"}
    >
      <Icon name={TYPES[type].icon} size={14} />
      <span className="msg-text">{message.msg}</span>
      {message.action && (
        <button
          className="msg-action"
          onClick={() => {
            message.action.onClick();
            onDismiss();
          }}
        >
          {message.action.label}
        </button>
      )}
      <button className="msg-dismiss" onClick={onDismiss} aria-label="Dismiss message">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
