import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { formatBytes, getFileBadge } from "@/utils/FileUtils";

interface GlacierTransferHistoryProps {
  records: FileTransferRecord[];
  getPeerName: (peerId: string) => string;
}

export const GlacierTransferHistory = ({ records, getPeerName }: GlacierTransferHistoryProps) => {
  const completedOrFailedRecords = records.filter(
    (record) => record.status === "completed" || record.status === "failed",
  );

  const completedCount = completedOrFailedRecords.filter((r) => r.status === "completed").length;

  return (
    <section className="flex flex-col gap-3 pt-2">
      <div className="flex items-center justify-between pb-1 px-1">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight text-on-surface font-headline">Transfer History</h2>
          <span className="text-xs text-on-surface-variant font-label bg-surface-container-high px-2 py-0.5 rounded-full border border-outline-variant">
            {completedCount} completed
          </span>
        </div>
      </div>

      {completedOrFailedRecords.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {completedOrFailedRecords.map((record) => {
            const peerName = getPeerName(record.peerId);
            const isCompleted = record.status === "completed";
            const isOutgoing = record.direction === "outgoing";

            return (
              <div
                key={record.id}
                className="p-4 rounded-xl bg-surface-container/40 border border-outline-variant/40 hover:bg-surface-container-high/40 transition-colors flex flex-col justify-between gap-3 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-high text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-outline-variant font-label">
                      {getFileBadge(record.fileMetadata.name)}
                    </div>
                    <div className="min-w-0">
                      <h4
                        className="text-sm font-semibold text-on-surface font-headline truncate"
                        title={record.fileMetadata.name}
                      >
                        {record.fileMetadata.name}
                      </h4>
                      <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-0.5">
                        <span className="font-mono text-[11px]">{formatBytes(record.fileMetadata.size)}</span>
                        <span className="truncate">{isOutgoing ? `To ${peerName}` : `From ${peerName}`}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {isCompleted ? (
                  <div className="flex flex-col gap-1">
                    <div className="w-full bg-surface-container-lowest h-1 rounded-full overflow-hidden border border-outline-variant">
                      <div className="h-full rounded-full bg-primary w-full" />
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-on-surface-variant">
                      <span className="text-on-surface-variant font-mono">100% Complete</span>
                      <span className="text-primary font-medium font-label">Transfer complete</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="w-full bg-surface-container-lowest h-1 rounded-full overflow-hidden border border-outline-variant">
                      <div className="h-full rounded-full bg-red-500 w-full" />
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-red-400">
                      <span className="font-mono">Failed</span>
                      <span className="font-medium font-label truncate" title={record.error ?? "Transfer failed"}>
                        {record.error ?? "Transfer failed"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-on-surface-variant">
          No transfers yet. Transferred files will appear here once sent or received.
        </div>
      )}
    </section>
  );
};

GlacierTransferHistory.displayName = "GlacierTransferHistory";
export default GlacierTransferHistory;
