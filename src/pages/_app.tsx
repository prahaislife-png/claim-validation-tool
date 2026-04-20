import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import type { AppProps } from 'next/app';
import { Analytics } from '@vercel/analytics/next';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CVP] Uncaught client error:', error.message);
    console.error('[CVP] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif', padding: '24px',
          textAlign: 'center', background: '#f8fafc',
        }}>
          <div style={{ maxWidth: '440px' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '4px' }}>
              {this.state.error.message}
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '24px' }}>
              Open the browser console for details · Claim Validation Portal
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                height: '40px', padding: '0 24px', borderRadius: '8px',
                background: '#1e40af', color: '#fff', border: 'none',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <Component {...pageProps} />
        <Analytics />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
