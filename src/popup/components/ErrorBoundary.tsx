import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.handleUnhandledRejection = this.handleUnhandledRejection.bind(this);
    this.handleGlobalError = this.handleGlobalError.bind(this);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public override componentDidMount() {
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('error', this.handleGlobalError);
  }

  public override componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleGlobalError);
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent) {
    console.error('Unhandled promise rejection:', event.reason);
    this.setState({
      hasError: true,
      error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
    });
  }

  private handleGlobalError(event: ErrorEvent) {
    console.error('Global error:', event.error);
    this.setState({
      hasError: true,
      error: event.error || new Error(event.message),
    });
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, textAlign: 'center', fontFamily: '-apple-system, system-ui' }}>
          <h3 style={{ marginBottom: 10, color: 'var(--error)' }}>Something went wrong</h3>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => chrome.runtime.reload()}
            style={{
              padding: '8px 16px',
              background: 'var(--brand-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Reload Popup
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
