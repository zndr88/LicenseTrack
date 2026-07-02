import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--bg-1)',
          fontFamily: 'var(--font-ui)',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h1 style={{ color: 'var(--text-1)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: 'var(--text-2)', marginBottom: '1.5rem' }}>
            An unexpected error occurred. Reload the page to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              appearance: 'none',
              background: 'none',
              border: '1px solid var(--red-text)',
              color: 'var(--red-text)',
              fontFamily: 'var(--font-ui)',
              fontSize: '0.875rem',
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
