export type CandidatePairType = "direct" | "relay" | "unknown";

interface StatsTransport {
  type: string;
  selectedCandidatePairId?: string;
}

interface StatsCandidatePair {
  type: string;
  id?: string;
  selected?: boolean;
  state?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
}

interface StatsCandidate {
  type: string;
  candidateType?: string;
}

/**
 * Parses an RTCStatsReport (or equivalent Map in node/test environments)
 * to determine whether the active connection is direct (p2p/host/srflx/prflx)
 * or relay (TURN).
 */
export function parseCandidatePairStats(
  stats: RTCStatsReport | Map<string, Record<string, unknown>>,
): CandidatePairType {
  let selectedCandidatePairId: string | undefined;

  for (const report of stats.values()) {
    const transport = report as unknown as StatsTransport;
    if (transport.type === "transport" && typeof transport.selectedCandidatePairId === "string") {
      selectedCandidatePairId = transport.selectedCandidatePairId;
      break;
    }

    const pair = report as unknown as StatsCandidatePair;
    if (pair.type === "candidate-pair" && (pair.selected === true || pair.state === "succeeded")) {
      selectedCandidatePairId = typeof pair.id === "string" ? pair.id : undefined;
      break;
    }
  }

  if (!selectedCandidatePairId) {
    return "unknown";
  }

  const statsMap = stats as unknown as Map<string, unknown>;
  const rawPair = statsMap.get(selectedCandidatePairId);
  if (!rawPair) {
    return "unknown";
  }

  const pair = rawPair as StatsCandidatePair;
  const localCandId = typeof pair.localCandidateId === "string" ? pair.localCandidateId : undefined;
  const remoteCandId = typeof pair.remoteCandidateId === "string" ? pair.remoteCandidateId : undefined;

  const localCand = localCandId ? (statsMap.get(localCandId) as StatsCandidate | undefined) : undefined;
  const remoteCand = remoteCandId ? (statsMap.get(remoteCandId) as StatsCandidate | undefined) : undefined;

  if (localCand?.candidateType === "relay" || remoteCand?.candidateType === "relay") {
    return "relay";
  }

  if (localCand?.candidateType || remoteCand?.candidateType) {
    return "direct";
  }

  return "unknown";
}

export async function getSelectedCandidatePairType(pc: RTCPeerConnection): Promise<CandidatePairType> {
  try {
    const stats = await pc.getStats();
    return parseCandidatePairStats(stats);
  } catch {
    return "unknown";
  }
}
