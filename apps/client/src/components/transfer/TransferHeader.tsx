import { FiUser } from "react-icons/fi";

interface TransferHeaderProps {
  peerName: string;
}

export const TransferHeader = ({ peerName }: TransferHeaderProps) => {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-3 lg:px-6 lg:py-4 backdrop-blur-md">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-tangerine-dream-500 to-cinnamon-wood-500 text-white shadow-lg">
        <FiUser size={20} aria-hidden="true" />
      </div>
      <div>
        <h3 className="font-bold text-foreground text-base">{peerName}</h3>
        <p className="flex items-center gap-1.5 text-xs text-evergreen-500">
          <span
            className="block h-2 w-2 rounded-full bg-evergreen-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
            aria-hidden="true"
          />
          <span className="sr-only">Status: </span>
          Connected
        </p>
      </div>
    </div>
  );
};

TransferHeader.displayName = "TransferHeader";
