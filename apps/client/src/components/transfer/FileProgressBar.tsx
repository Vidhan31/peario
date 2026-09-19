import { use } from "react";

import { TransferContext } from "@/contexts/TransferContext";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import { formatProgressBytes } from "@/utils/FileUtils";

interface FileProgressBarProps {
  transferId: string;
  totalBytes: number;
  isOutgoing?: boolean;
}

export const FileProgressBar = ({ transferId, totalBytes, isOutgoing = false }: FileProgressBarProps) => {
  const transferContext = use(TransferContext);
  if (!transferContext) {
    throw new Error("TransferContext is not available");
  }
  const { progressController } = transferContext;

  const progress = useSmoothProgress(transferId, totalBytes, progressController);
  const percentage = totalBytes > 0 ? Math.min((progress.bytesTransferred / totalBytes) * 100, 100) : 0;
  const { transferred: formattedTransferred, total: formattedTotal } = formatProgressBytes(
    progress.bytesTransferred,
    totalBytes,
  );

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span
          className={`whitespace-nowrap tabular-nums font-mono ${isOutgoing ? "text-primary-foreground/90" : "text-muted-foreground"}`}
        >
          <span className="inline-block text-right" style={{ minWidth: `${formattedTotal.length}ch` }}>
            {formattedTransferred}
          </span>
          {` / ${formattedTotal}`}
        </span>
        <span
          className={`min-w-[6ch] text-right tabular-nums font-mono ${isOutgoing ? "text-primary-foreground/90" : "text-muted-foreground"}`}
        >
          {`${percentage.toFixed(1)}%`}
        </span>
      </div>
      <div
        className={`h-2 w-full overflow-hidden rounded-full ${isOutgoing ? "bg-primary-foreground/30" : "bg-muted"}`}
      >
        <div
          className={`h-full w-full origin-left transition-transform duration-150 ease-linear will-change-transform ${isOutgoing ? "bg-primary-foreground" : "bg-primary"}`}
          style={{ transform: `scaleX(${percentage / 100})` }}
        />
      </div>
    </div>
  );
};

FileProgressBar.displayName = "FileProgressBar";
