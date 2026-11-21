import Icon from "./Icon.jsx";

// Shown in place of a list's empty state when the list could not be loaded.
export default function LoadError({ message, onRetry }) {
  return (
    <div className="lp-error" role="alert">
      <Icon name="alert" size={16} color="var(--red-text)" />
      <span>{message}</span>
      <button type="button" className="lp-error-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}
