import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
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
