import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

// Under strict CSP without 'unsafe-eval', prevent Zod from probing `new Function("")`
z.config({ jitless: true });

import { GlobalErrorBoundary } from "./components/error/GlobalErrorBoundary.tsx";
import { ThemeProvider } from "./contexts/ThemeProvider.tsx";
import { Home } from "./Home.tsx";
import "./index.css";
import "./view-transitions.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <ThemeProvider>
          <Home />
        </ThemeProvider>
      </GlobalErrorBoundary>
    </StrictMode>,
  );
}
