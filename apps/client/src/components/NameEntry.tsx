import { useActionState, useEffect, useRef } from "react";
import { FiArrowRight } from "react-icons/fi";

import PearLogo from "./PearLogo";
import { ThemeToggle } from "./theme/ThemeToggle";

export function validateNameInput(
  formData: FormData,
): { success: true; name: string } | { success: false; error: string } {
  const rawName = formData.get("name");
  if (typeof rawName !== "string") {
    return { success: false, error: "Invalid name format" };
  }
  const trimmedName = rawName.trim();
  if (!trimmedName) {
    return { success: false, error: "Name is required" };
  }
  return { success: true, name: trimmedName };
}

interface NameEntryProps {
  onNameSubmit: (name: string) => void;
}

export default function NameEntry({ onNameSubmit }: NameEntryProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const [error, submitAction, isPending] = useActionState((_previousState: string | null, formData: FormData) => {
    const validation = validateNameInput(formData);
    if (!validation.success) {
      return validation.error;
    }
    onNameSubmit(validation.name);
    return null;
  }, null);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-300 selection:bg-primary selection:text-background">
      {/* Navbar without line separator */}
      <nav
        className="w-full max-w-7xl mx-auto flex items-center justify-between px-6 sm:px-12 py-6"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-3">
          <PearLogo className="w-9 h-9" />
          <span className="text-xl font-bold tracking-tight text-on-surface font-headline">PearIO</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden md:inline text-xs text-on-surface-variant font-label">
            Direct peer-to-peer · Zero storage
          </span>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center max-w-5xl mx-auto">
        {/* Headline */}
        <h1 className="mb-4 text-4xl font-bold leading-tight tracking-tight sm:mb-6 sm:text-5xl md:text-6xl lg:text-7xl font-headline animate-in fade-in slide-in-from-bottom-6 duration-700">
          Share without limits.
          <br />
          <span className="text-primary">Transfer without traces.</span>
        </h1>

        {/* Subheadline */}
        <p className="mb-8 max-w-2xl text-sm text-on-surface-variant sm:mb-12 sm:text-base md:text-lg animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100 font-body">
          Direct browser-to-browser streaming. Files stream straight to your peer&apos;s disk with end-to-end
          encryption. No intermediate cloud storage, zero server footprint.
        </p>

        {/* Name Entry Form */}
        <div className="w-full max-w-md px-2 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
          <form action={submitAction} className="relative flex flex-col gap-3 sm:flex-row sm:gap-3">
            <div className="relative flex-1">
              <label htmlFor="display-name-input" className="sr-only">
                Display name
              </label>
              <input
                ref={inputRef}
                id="display-name-input"
                type="text"
                name="name"
                aria-label="Display name"
                placeholder="Enter your display name..."
                className="w-full rounded-xl border border-outline-variant bg-surface-container/60 px-4 py-3 text-sm sm:text-base text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all glass-panel"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              aria-label={isPending ? "Starting session..." : "Start session"}
              className="group flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm sm:text-base font-bold text-primary-foreground transition-colors hover:bg-secondary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 font-label shrink-0 shadow-sm cursor-pointer"
            >
              {isPending ? (
                <span
                  role="status"
                  aria-label="Loading"
                  className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <>
                  <span>Start</span>
                  <FiArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs sm:text-sm text-red-400 border border-red-500/20"
            >
              {error}
            </div>
          )}
        </div>
      </main>

      {/* Footer Info without hard line */}
      <footer className="py-4 px-6 text-center text-xs text-on-surface-variant font-label">
        Transfers run peer-to-peer. A signaling server is only used to discover and establish direct peer links.
      </footer>
    </div>
  );
}
