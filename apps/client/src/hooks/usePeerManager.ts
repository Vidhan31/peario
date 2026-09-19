import { use, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { PeerConnectionType } from "../types/PeerConnectionTypes";

import { PeersContext } from "../contexts/PeersContext";
import { socket } from "../lib/SocketService";
import { PeerMesh, type PeerMeshSnapshot } from "../lib/webrtc/PeerMesh";

const EMPTY_SNAPSHOT: PeerMeshSnapshot = {
  connectionStates: new Map(),
  relayStatuses: new Map(),
  remotePeers: new Map(),
  channelsVersion: 0,
};

export function usePeerManager(): PeerConnectionType {
  const peersContext = use(PeersContext);
  const myself = peersContext?.localPeer ?? null;

  const [mesh, setMesh] = useState<PeerMesh | null>(null);

  useEffect(() => {
    const nextMesh = new PeerMesh({ socket, localPeer: null });
    // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect -- intentional mesh lifecycle in effect; construction binds socket listeners and must not run during render
    setMesh(nextMesh);
    return () => {
      nextMesh.destroy();
      setMesh(null);
    };
  }, []);

  useEffect(() => {
    mesh?.setLocalPeer(myself);
  }, [mesh, myself]);

  const subscribe = useCallback((listener: () => void) => mesh?.subscribe(listener) ?? (() => undefined), [mesh]);
  const getSnapshot = useCallback((): PeerMeshSnapshot => mesh?.getSnapshot() ?? EMPTY_SNAPSHOT, [mesh]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const methods = useMemo(
    () => ({
      getPeerConnection: (...args: Parameters<PeerMesh["getPeerConnection"]>) =>
        mesh?.getPeerConnection(...args) ?? null,
      getDataChannel: (...args: Parameters<PeerMesh["getDataChannel"]>) => mesh?.getDataChannel(...args) ?? null,
      waitForChannel: (...args: Parameters<PeerMesh["waitForChannel"]>) =>
        mesh?.waitForChannel(...args) ?? Promise.reject(new Error("Peer mesh is not ready")),
      closePeerConnection: (...args: Parameters<PeerMesh["closePeerConnection"]>) => mesh?.closePeerConnection(...args),
      initiateConnection: (...args: Parameters<PeerMesh["initiateConnection"]>) =>
        mesh?.initiateConnection(...args) ?? Promise.resolve(),
      sendConnectionRequest: (...args: Parameters<PeerMesh["sendConnectionRequest"]>) =>
        mesh?.sendConnectionRequest(...args),
      connectToRoom: (...args: Parameters<PeerMesh["connectToRoom"]>) => mesh?.connectToRoom(...args),
    }),
    [mesh],
  );

  return useMemo(
    () => ({
      ...methods,
      connectionStates: snapshot.connectionStates,
      relayStatuses: snapshot.relayStatuses,
      remotePeers: snapshot.remotePeers,
    }),
    [methods, snapshot],
  );
}
