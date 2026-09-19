import { describe, expect, it } from "vitest";

import { parseCandidatePairStats } from "../stats";

describe("parseCandidatePairStats", () => {
  it("returns 'relay' when local candidate is relay", () => {
    const stats = new Map<string, Record<string, unknown>>();
    stats.set("transport-1", {
      type: "transport",
      selectedCandidatePairId: "pair-1",
    });
    stats.set("pair-1", {
      type: "candidate-pair",
      id: "pair-1",
      localCandidateId: "cand-local",
      remoteCandidateId: "cand-remote",
    });
    stats.set("cand-local", {
      type: "local-candidate",
      candidateType: "relay",
    });
    stats.set("cand-remote", {
      type: "remote-candidate",
      candidateType: "host",
    });

    const result = parseCandidatePairStats(stats);
    expect(result).toBe("relay");
  });

  it("returns 'relay' when remote candidate is relay", () => {
    const stats = new Map<string, Record<string, unknown>>();
    stats.set("pair-1", {
      type: "candidate-pair",
      id: "pair-1",
      selected: true,
      localCandidateId: "cand-local",
      remoteCandidateId: "cand-remote",
    });
    stats.set("cand-local", {
      type: "local-candidate",
      candidateType: "srflx",
    });
    stats.set("cand-remote", {
      type: "remote-candidate",
      candidateType: "relay",
    });

    const result = parseCandidatePairStats(stats);
    expect(result).toBe("relay");
  });

  it("returns 'direct' when neither candidate is relay", () => {
    const stats = new Map<string, Record<string, unknown>>();
    stats.set("transport-1", {
      type: "transport",
      selectedCandidatePairId: "pair-1",
    });
    stats.set("pair-1", {
      type: "candidate-pair",
      id: "pair-1",
      localCandidateId: "cand-local",
      remoteCandidateId: "cand-remote",
    });
    stats.set("cand-local", {
      type: "local-candidate",
      candidateType: "host",
    });
    stats.set("cand-remote", {
      type: "remote-candidate",
      candidateType: "host",
    });

    const result = parseCandidatePairStats(stats);
    expect(result).toBe("direct");
  });

  it("returns 'unknown' when no candidate pair is selected", () => {
    const stats = new Map<string, Record<string, unknown>>();
    stats.set("cand-local", {
      type: "local-candidate",
      candidateType: "host",
    });

    const result = parseCandidatePairStats(stats);
    expect(result).toBe("unknown");
  });
});
