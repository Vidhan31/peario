import type { FallbackProps } from "react-error-boundary";

import { ErrorBoundary } from "react-error-boundary";
import { FiAlertTriangle } from "react-icons/fi";

import { logger } from "@/lib/logger";

interface PanelErrorFallbackProps extends FallbackProps {
  panelName: string;
}

function PanelErrorFallback({ error, resetErrorBoundary, panelName }: PanelErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-outline-variant/60 bg-surface-container/70 glass-elevated p-5 font-body"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
          <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />
        </div>
        <h3 className="font-semibold text-sm text-on-surface font-headline">{panelName} Error</h3>
      </div>

      <p className="mb-3 text-xs text-on-surface-variant font-body leading-relaxed">
        {panelName} encountered an unexpected error. You can retry or refresh the page.
      </p>

      <details className="mb-3 rounded-xl bg-surface-container-lowest p-2.5 border border-outline-variant/40 text-left">
        <summary className="cursor-pointer text-xs font-medium text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-1 focus:ring-primary font-label">
          Error details
        </summary>
        <pre className="mt-1.5 max-h-32 overflow-auto text-xs font-mono text-red-400">
          {error instanceof Error ? error.message : "Unknown error"}
        </pre>
      </details>

      <button
        type="button"
        onClick={resetErrorBoundary}
        className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground font-label transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer shadow-sm"
      >
        Retry
      </button>
    </div>
  );
}

interface PanelErrorBoundaryProps {
  children: React.ReactNode;
  panelName: string;
  resetKeys?: unknown[];
  onReset?: () => void;
}

export function PanelErrorBoundary({ children, panelName, resetKeys, onReset }: PanelErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={(props) => <PanelErrorFallback {...props} panelName={panelName} />}
      {...(resetKeys ? { resetKeys } : {})}
      onReset={() => {
        onReset?.();
      }}
      onError={(error, info) => {
        logger.error(`Panel error in ${panelName}:`, error, info.componentStack);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
