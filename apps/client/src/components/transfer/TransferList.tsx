import { useEffect, useRef } from "react";
import { FiShare2 } from "react-icons/fi";

import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { TransferCard } from "./TransferCard";

interface TransferListProps {
  records: FileTransferRecord[];
}

export const TransferList = ({ records }: TransferListProps) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4 lg:p-6" role="log" aria-label="File transfer history">
      {records.length === 0 && (
        <div role="status" className="flex h-full flex-col items-center justify-center text-center p-8">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
            <FiShare2 size={28} aria-hidden="true" />
          </div>
          <p className="text-foreground font-medium text-base">No file transfers yet</p>
          <p className="text-muted-foreground text-sm mt-1 max-w-xs">
            Send a file using the button below to start transferring directly to this peer.
          </p>
        </div>
      )}

      {records.map((record) => (
        <TransferCard key={record.id} record={record} />
      ))}
      <div ref={endRef} />
    </div>
  );
};

TransferList.displayName = "TransferList";
