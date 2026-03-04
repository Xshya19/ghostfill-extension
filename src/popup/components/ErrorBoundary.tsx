import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, textAlign: 'center', fontFamily: '-apple-system, system-ui' }}>
                    <h3 style={{ marginBottom: 10, color: 'var(--ios-error)' }}>Something went wrong</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
                        {this.state.error?.message || 'Unknown error'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '8px 16px',
                            background: 'var(--ios-indigo)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 14,
                            fontWeight: 500
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
