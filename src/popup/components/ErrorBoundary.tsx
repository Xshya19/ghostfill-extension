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
    // Resource-loading failures (img/script/link) bubble as ErrorEvents whose
    // target is the element rather than window, and carry no real Error object.
    // These should never replace the whole UI with the crash screen.
    if (event.target && event.target !== window) {
      return;
    }
    // Ignore known-benign browser noise (e.g. the harmless "ResizeObserver loop" warning).
    if (event.message && event.message.includes('ResizeObserver loop')) {
      return;
    }
    if (!event.error) {
      return;
    }
    console.error('Global error:', event.error);
    this.setState({ hasError: true, error: event.error });
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="memphis-card error-card">
            <div className="error-icon-box">
              <span className="error-icon-large">⚠️</span>
            </div>
            <h2 className="error-title">System Error</h2>
            <p className="error-message-box">
              The popup interface failed to render. Reset the interface to reload GhostFill.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.reload();
              }}
              className="ios-button button-primary error-reset-btn"
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
