import type { FallbackProps } from "react-error-boundary";

import { ErrorBoundary } from "react-error-boundary";
import { FiAlertTriangle } from "react-icons/fi";

import { logger } from "@/lib/logger";

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground px-4">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-outline-variant/60 bg-surface-container/70 glass-elevated p-8 shadow-xl text-center font-body"
      >
        <div className="mb-4 flex items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center">
            <FiAlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>

        <h1 className="mb-2 text-xl font-bold text-on-surface font-headline">Something went wrong</h1>

        <p className="mb-4 text-sm text-on-surface-variant font-body leading-relaxed">
          An unexpected error occurred. You can try refreshing the page or reloading the application.
        </p>

        <details className="mb-6 rounded-xl bg-surface-container-lowest p-3 text-left border border-outline-variant/40">
          <summary className="cursor-pointer text-xs font-medium text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-1 focus:ring-primary font-label">
            Error details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto text-xs font-mono text-red-400">
            {error instanceof Error ? error.message : "Unknown error"}
          </pre>
        </details>

        <button
          type="button"
          onClick={resetErrorBoundary}
          className="w-full rounded-xl bg-primary px-4 py-2.5 font-semibold text-xs font-label text-primary-foreground hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer shadow-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        logger.error("Global application error:", error, info.componentStack);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
