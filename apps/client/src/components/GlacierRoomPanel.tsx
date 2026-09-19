import { use, useState } from "react";
import { FiCopy, FiHash, FiShare2 } from "react-icons/fi";

import type { Toast } from "@/types/Toast";

import { ToastContext, type ToastContextType } from "@/contexts/ToastContext";
import { logger } from "@/lib/logger";

function notify(toastContext: ToastContextType | null, toast: Omit<Toast, "id">) {
  if (toastContext) {
    toastContext.addToast(toast);
  }
}

interface GlacierRoomPanelProps {
  personalRoomId: string | undefined;
  onJoinRoom: (roomId: string) => void;
}

export const GlacierRoomPanel = ({ personalRoomId, onJoinRoom }: GlacierRoomPanelProps) => {
  const [targetRoomInput, setTargetRoomInput] = useState("");
  const toastContext = use(ToastContext);

  const handleCopyRoomId = async () => {
    if (!personalRoomId) return;
    try {
      await navigator.clipboard.writeText(personalRoomId);
      notify(toastContext, {
        type: "success",
        title: "Copied",
        message: "Room ID copied to clipboard",
        duration: 2500,
      });
    } catch (err: unknown) {
      logger.error("Failed to copy room ID:", err);
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
        duration: 2500,
      });
    } catch (err: unknown) {
      logger.error("Failed to copy invite link:", err);
    }
  };

  const handleJoinSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (targetRoomInput.trim()) {
      onJoinRoom(targetRoomInput.trim().toUpperCase());
      setTargetRoomInput("");
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between h-9 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-label flex items-center gap-2">
          <FiHash className="w-3.5 h-3.5" aria-hidden="true" />
          Room Code
        </h2>
      </div>

      <div className="flex flex-col gap-3 p-3 rounded-xl bg-surface-container/40 border border-outline-variant/40">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-medium text-on-surface-variant shrink-0 font-label uppercase">Your code:</span>
          <div className="bg-surface-container-high border border-primary/40 px-3.5 py-1.5 rounded-lg font-mono text-xs font-semibold tracking-wider text-primary">
            {personalRoomId ?? "..."}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyRoomId()}
            aria-label="Copy Room Code"
            className="px-3 py-1.5 rounded-lg border border-outline-variant hover:border-primary/50 hover:bg-surface-container text-xs font-medium text-on-surface transition-colors font-label flex items-center gap-1 cursor-pointer"
          >
            <FiCopy className="w-3.5 h-3.5" aria-hidden="true" />
            Copy
          </button>
          <button
            type="button"
            onClick={() => void handleCopyInviteLink()}
            aria-label="Share Invite Link"
            className="p-2 rounded-lg border border-outline-variant hover:border-primary/50 hover:bg-surface-container text-xs font-medium text-on-surface transition-colors cursor-pointer"
            title="Copy Invite Link"
          >
            <FiShare2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleJoinSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={targetRoomInput}
            onChange={(e) => setTargetRoomInput(e.target.value.toUpperCase())}
            placeholder="e.g. PEAR-1092-AB"
            maxLength={16}
            aria-label="Enter room code to join"
            className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none uppercase bg-surface-container text-on-surface placeholder:normal-case placeholder:text-on-surface-variant font-mono"
          />
          <button
            type="submit"
            disabled={!targetRoomInput.trim()}
            aria-label="Join Room"
            className="px-3.5 py-1.5 bg-primary hover:bg-secondary text-primary-foreground text-xs font-bold rounded-lg transition-colors shrink-0 font-label disabled:opacity-50 cursor-pointer"
          >
            Join
          </button>
        </form>
      </div>
    </section>
  );
};

GlacierRoomPanel.displayName = "GlacierRoomPanel";
export default GlacierRoomPanel;
