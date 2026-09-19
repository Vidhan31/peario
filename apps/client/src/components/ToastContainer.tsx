import { use } from "react";
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiX, FiXCircle } from "react-icons/fi";

import type { ToastType } from "../types/Toast";

import { ToastContext } from "../contexts/ToastContext";

const typeBadgeStyles: Record<ToastType, { badge: string; icon: React.ReactNode }> = {
  info: {
    badge: "bg-primary/10 text-primary border border-primary/20",
    icon: <FiInfo aria-hidden="true" className="w-4 h-4" />,
  },
  warning: {
    badge: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    icon: <FiAlertTriangle aria-hidden="true" className="w-4 h-4" />,
  },
  error: {
    badge: "bg-red-500/10 text-red-500 border border-red-500/20",
    icon: <FiXCircle aria-hidden="true" className="w-4 h-4" />,
  },
  success: {
    badge: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
    icon: <FiCheckCircle aria-hidden="true" className="w-4 h-4" />,
  },
};

export const ToastContainer = () => {
  const context = use(ToastContext);
  if (!context) return null;

  const { toasts, removeToast } = context;

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2.5 max-w-sm sm:max-w-md w-full px-2"
    >
      {toasts.map((toast) => {
        const style = typeBadgeStyles[toast.type];

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-2xl glass-elevated border border-outline-variant/60 p-4 shadow-xl transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${style.badge}`}>
              {style.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-xs sm:text-sm text-on-surface font-headline leading-snug">
                {toast.title}
              </h4>
              <p className="mt-0.5 text-xs text-on-surface-variant font-body leading-relaxed">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                removeToast(toast.id);
              }}
              className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer shrink-0"
              aria-label={`Dismiss notification: ${toast.title}`}
            >
              <FiX size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
