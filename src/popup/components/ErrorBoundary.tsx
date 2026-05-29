import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error | undefined;
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
        <div
          className="app-skeleton app-view-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '32px',
            textAlign: 'center',
            height: '100%',
            background: 'var(--gf-bg)',
          }}
        >
          <div
            className="glass-card"
            style={{
              padding: '24px',
              border: '2px solid var(--gf-ink)',
              boxShadow: '4px 4px 0 var(--gf-ink)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              maxWidth: '320px',
              background: 'var(--gf-card)',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                background: 'var(--gf-coral)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid var(--gf-ink)',
                boxShadow: '2px 2px 0 var(--gf-ink)',
              }}
            >
              <span style={{ fontSize: '24px' }}>⚠️</span>
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '18px',
                fontWeight: '700',
                textTransform: 'uppercase',
                color: 'var(--gf-cream)',
                margin: 0,
              }}
            >
              System Error
            </h2>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--gf-coral)',
                background: 'rgba(var(--gf-coral-rgb), 0.1)',
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1.5px solid var(--gf-ink)',
                wordBreak: 'break-all',
                width: '100%',
                maxHeight: '100px',
                overflowY: 'auto',
                margin: 0,
              }}
            >
              {this.state.error?.message || 'Unknown error occurred'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.reload();
              }}
              className="ios-button button-primary"
              style={{ width: '100%', marginTop: '8px', cursor: 'pointer' }}
            >
              Reset Interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
