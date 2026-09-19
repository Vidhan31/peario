import type { FallbackProps } from "react-error-boundary";

import { ErrorBoundary } from "react-error-boundary";
import { FiAlertTriangle } from "react-icons/fi";

import { logger } from "@/lib/logger";

function MessageListErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center p-6 text-center font-body">
      <div className="mb-4 w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center">
        <FiAlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>

      <h3 className="mb-2 font-semibold text-sm text-on-surface font-headline">Transfer List Error</h3>

      <p className="mb-4 max-w-sm text-xs text-on-surface-variant font-body leading-relaxed">
        Unable to display transfer history. You can still send new files.
      </p>

      <details className="mb-4 w-full max-w-sm rounded-xl bg-surface-container-lowest p-2.5 border border-outline-variant/40 text-left">
        <summary className="cursor-pointer text-xs font-medium text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-1 focus:ring-primary font-label">
          Technical details
        </summary>
        <pre className="mt-1.5 max-h-24 overflow-auto text-xs font-mono text-red-400">
          {error instanceof Error ? error.message : "Unknown error"}
        </pre>
      </details>

      <button
        type="button"
        onClick={resetErrorBoundary}
        className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground font-label transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer shadow-sm"
      >
        Retry Loading Transfers
      </button>
    </div>
  );
}

interface MessageListErrorBoundaryProps {
  children: React.ReactNode;
  resetKeys?: unknown[];
  onReset?: () => void;
}

export function MessageListErrorBoundary({ children, resetKeys, onReset }: MessageListErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={MessageListErrorFallback}
      {...(resetKeys ? { resetKeys } : {})}
      {...(onReset ? { onReset } : {})}
      onError={(error, info) => {
        logger.error("Message list rendering error:", error, info.componentStack);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
