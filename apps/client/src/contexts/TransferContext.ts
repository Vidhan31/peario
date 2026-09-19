import { createContext } from "react";

import type { ProgressController } from "@/hooks/useProgressController";

export interface TransferContextType {
  progressController: ProgressController;
  onAcceptFile: () => void;
  onPauseFile: () => void;
  onResumeFile: () => void;
  onCancelFile: () => void;
  isOutgoingPaused: boolean;
}

export const TransferContext = createContext<TransferContextType | null>(null);
