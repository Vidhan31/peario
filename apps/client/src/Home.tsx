import { Suspense, useEffect, useState } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import NameEntry from "./components/NameEntry.tsx";
import Pear from "./components/Pear.tsx";
import { ToastContainer } from "./components/ToastContainer.tsx";
import { QUERY_PARAMS, STORAGE_KEYS } from "./constants/index.ts";
import { PeerConnectionProvider } from "./contexts/PeerConnectionProvider.tsx";
import { PeersProvider } from "./contexts/PeersProvider.tsx";
import { ToastProvider } from "./contexts/ToastProvider.tsx";
import { useSocketErrorHandler } from "./hooks/useSocketErrorHandler.ts";
import { checkAndActivateTurnFromUrl } from "./lib/iceServers.ts";
import { socketService } from "./lib/SocketService.ts";
import { registerServiceWorker } from "./sw-register.ts";

function IdentityErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground p-4">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-outline-variant/60 bg-surface-container/70 glass-elevated p-8 text-center shadow-xl font-body"
      >
        <h1 className="mb-2 text-xl font-bold text-on-surface font-headline">Failed to connect</h1>
        <p className="mb-4 text-sm text-on-surface-variant font-body leading-relaxed">
          Could not establish your identity with the signaling server.
        </p>
        <pre className="mb-6 max-h-32 overflow-auto rounded-xl bg-surface-container-lowest p-3 text-xs font-mono text-red-400 text-left border border-outline-variant/40">
          {errorMessage}
        </pre>
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

const AppContent = ({ userName, initialRoomId }: { userName: string; initialRoomId: string | null }) => {
  useSocketErrorHandler();

  return (
    <ErrorBoundary
      FallbackComponent={IdentityErrorFallback}
      onReset={() => {
        socketService.resetIdentity();
        socketService.connect();
      }}
    >
      <Suspense
        fallback={
          <div
            role="status"
            aria-label="Connecting"
            className="flex h-screen items-center justify-center bg-background text-foreground"
          >
            Connecting...
          </div>
        }
      >
        <PeersProvider userName={userName}>
          <PeerConnectionProvider>
            <Pear initialRoomId={initialRoomId} />
          </PeerConnectionProvider>
        </PeersProvider>
      </Suspense>
    </ErrorBoundary>
  );
};

export const Home = () => {
  const [userName, setUserName] = useState<string | null>(() => {
    return sessionStorage.getItem(STORAGE_KEYS.USERNAME);
  });
  const [initialRoomId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get(QUERY_PARAMS.ROOM);
  });

  useEffect(() => {
    registerServiceWorker();
    checkAndActivateTurnFromUrl();
  }, []);

  useEffect(() => {
    if (userName) {
      socketService.connect();
    }
  }, [userName]);

  const handleNameSubmit = (name: string) => {
    sessionStorage.setItem(STORAGE_KEYS.USERNAME, name);
    setUserName(name);
  };

  return (
    <ToastProvider>
      {!userName ? (
        <NameEntry onNameSubmit={handleNameSubmit} />
      ) : (
        <AppContent userName={userName} initialRoomId={initialRoomId} />
      )}
      <ToastContainer />
    </ToastProvider>
  );
};

export default Home;
