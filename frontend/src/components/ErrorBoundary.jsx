import React from "react";

// Catches render errors below it. Without a `fallback` it shows the full-screen
// message used around the whole app; pass `fallback({ error, reset })` to
// render something scoped instead (a page, an extension slot). To clear the
// error when the content changes, give the boundary a `key`.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`${this.props.label || "ErrorBoundary"} caught:`, error, info);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return (
        <div className="error-boundary">
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-copy">
            An unexpected error occurred. Reload the page to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="error-boundary-reload"
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
