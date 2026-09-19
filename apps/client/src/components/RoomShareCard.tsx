import { use } from "react";
import { FiCopy, FiHash, FiShare2 } from "react-icons/fi";

import type { Toast } from "@/types/Toast";

import { ToastContext, type ToastContextType } from "@/contexts/ToastContext";
import { logger } from "@/lib/logger";

function notify(toastContext: ToastContextType | null, toast: Omit<Toast, "id">) {
  if (toastContext) {
    toastContext.addToast(toast);
  }
}

interface RoomShareCardProps {
  personalRoomId: string | undefined;
}

export const RoomShareCard = ({ personalRoomId }: RoomShareCardProps) => {
  const toastContext = use(ToastContext);

  const handleCopyRoomId = async () => {
    if (!personalRoomId) return;
    try {
      await navigator.clipboard.writeText(personalRoomId);
      notify(toastContext, {
        type: "success",
        title: "Copied",
        message: "Room ID copied to clipboard",
        duration: 3000,
      });
    } catch (err: unknown) {
      logger.error("Failed to copy room ID to clipboard:", err);
      notify(toastContext, {
        type: "error",
        title: "Copy Failed",
        message: "Unable to copy room ID to clipboard. Please copy manually.",
        duration: 4000,
      });
    }
  };

  const handleCopyInviteLink = async () => {
    if (!personalRoomId) return;
    try {
      const shareLink = `${window.location.origin}${window.location.pathname}?room=${personalRoomId}`;
      await navigator.clipboard.writeText(shareLink);
      notify(toastContext, {
        type: "success",
        title: "Copied",
        message: "Invite link copied to clipboard",
        duration: 3000,
      });
    } catch (err: unknown) {
      logger.error("Failed to copy invite link to clipboard:", err);
      notify(toastContext, {
        type: "error",
        title: "Copy Failed",
        message: "Unable to copy invite link to clipboard. Please copy manually.",
        duration: 4000,
      });
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-5 backdrop-blur-sm transition-all hover:bg-muted/60 hover:shadow-md hover:shadow-primary/5">
      <div className="mb-4 flex items-center gap-2 text-primary">
        <FiHash aria-hidden="true" />
        <h2 className="font-semibold text-sm uppercase tracking-wider">My Room ID</h2>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-background/50 p-4 ring-1 ring-border">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- blank room id should render the loading placeholder */}
          <span className="font-mono text-2xl font-bold tracking-widest text-primary">{personalRoomId || "..."}</span>
          <button
            type="button"
            onClick={() => void handleCopyRoomId()}
            className="text-muted-foreground hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary rounded p-1"
            title="Copy Room ID"
            aria-label="Copy Room ID"
          >
            <FiCopy size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopyInviteLink()}
            className="text-muted-foreground hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary rounded p-1"
            title="Copy Invite Link"
            aria-label="Copy Invite Link"
          >
            <FiShare2 size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" aria-hidden="true" />
          <span className="sr-only">Room active</span>
        </div>
      </div>
    </div>
  );
};

RoomShareCard.displayName = "RoomShareCard";
