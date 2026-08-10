import React, { Component, ReactNode } from 'react';
import { useLocalize } from '~/hooks';

/**
 * The boundary itself is a class, so it cannot localise anything. Its fallback
 * lives here instead — previously three English literals with the i18n lint rule
 * switched off and a comment claiming they came from somewhere localised.
 */
function SourcesUnavailable() {
  const localize = useLocalize();
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-border-medium bg-surface-secondary p-4 text-center"
      role="alert"
      aria-live="polite"
    >
      <div className="mb-2 text-sm text-text-secondary">{localize('com_sources_unavailable')}</div>
      <button
        onClick={() => window.location.reload()}
        className="hover:bg-surface-primary-hover rounded-md bg-surface-primary px-3 py-1 text-sm text-text-primary focus:outline-none"
      >
        {localize('com_sources_reload_page')}
      </button>
    </div>
  );
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showDetails?: boolean;
}

interface State {
  hasError: boolean;
}

class SourcesErrorBoundary extends Component<Props, State> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Sources error:', error);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <SourcesUnavailable />;
    }

    return this.props.children;
  }
}

export default SourcesErrorBoundary;
