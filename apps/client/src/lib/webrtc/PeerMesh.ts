import type { Socket } from "socket.io-client";

import {
  AnswerSchema,
  type AnswerToSend,
  ConnectionRequestSchema,
  ConnectToRoomSchema,
  formatValidationError,
  IceCandidateForPeerSchema,
  type IceCandidateToSend,
  OfferSchema,
  type OfferToSend,
  type Peer,
  type PeerId,
  PeerLeftDataSchema,
  validatePayload,
} from "@peario/shared";

import { DEFAULT_CHANNEL_LABELS, TIMEOUTS_MS } from "@/constants/index.ts";

import { reportClientError } from "../errorReporter";
import { fetchIceServers, getCachedIceServers } from "../iceServers";
import { dataChannelLogger, socketLogger, webrtcLogger } from "../logger";
import { type CandidatePairType, getSelectedCandidatePairType } from "./stats";

export interface PeerMeshSnapshot {
  connectionStates: Map<PeerId, RTCPeerConnectionState>;
  relayStatuses: Map<PeerId, CandidatePairType>;
  remotePeers: Map<PeerId, Peer>;
  channelsVersion: number;
}

export type RTCPeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

export interface PeerMeshOptions {
  socket: Socket;
  localPeer?: Peer | null;
  rtcFactory?: RTCPeerConnectionFactory;
  getIceServers?: () => Promise<RTCIceServer[]>;
  channelLabels?: string[];
}

const DEFAULT_LABELS = [...DEFAULT_CHANNEL_LABELS];

function createSessionDescription(init: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (typeof RTCSessionDescription !== "undefined") {
    return new RTCSessionDescription(init);
  }
  return init;
}

export class PeerMesh {
  private readonly socket: Socket;
  private localPeer: Peer | null;
  private readonly rtcFactory: RTCPeerConnectionFactory;
  private readonly getIceServers: () => Promise<RTCIceServer[]>;
  private readonly channelLabels: string[];

  private iceServers: RTCIceServer[];
  private readonly connections = new Map<PeerId, RTCPeerConnection>();
  private readonly dataChannels = new Map<PeerId, Map<string, RTCDataChannel>>();
  private readonly pendingCandidates = new Map<PeerId, RTCIceCandidateInit[]>();
  private readonly channelWaiters = new Map<string, ((channel: RTCDataChannel) => void)[]>();

  private snapshot: PeerMeshSnapshot = {
    connectionStates: new Map(),
    relayStatuses: new Map(),
    remotePeers: new Map(),
    channelsVersion: 0,
  };

  private readonly listeners = new Set<() => void>();
  private isDestroyed = false;
  private isSocketBound = false;

  constructor(options: PeerMeshOptions) {
    this.socket = options.socket;
    this.localPeer = options.localPeer ?? null;
    this.rtcFactory =
      options.rtcFactory ??
      ((config) => {
        if (typeof RTCPeerConnection === "undefined") {
          throw new Error("RTCPeerConnection is not supported in this environment");
        }
        return new RTCPeerConnection(config);
      });
    this.getIceServers = options.getIceServers ?? fetchIceServers;
    this.channelLabels = options.channelLabels ?? DEFAULT_LABELS;
    this.iceServers = getCachedIceServers();

    this.initIceServers();
    this.bindSocketEvents();
  }

  public get destroyed(): boolean {
    return this.isDestroyed;
  }

  public setLocalPeer = (peer: Peer | null): void => {
    this.localPeer = peer;
  };

  public getLocalPeer = (): Peer | null => {
    return this.localPeer;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): PeerMeshSnapshot => {
    return this.snapshot;
  };

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private initIceServers() {
    this.getIceServers()
      .then((servers) => {
        if (!this.isDestroyed) {
          this.iceServers = servers;
        }
      })
      .catch((error: unknown) => {
        webrtcLogger.warn("Failed to fetch fresh ICE servers, using cached fallback:", error);
      });
  }

  private getConfiguration(): RTCConfiguration {
    return {
      iceServers: this.iceServers,
    };
  }

  private addRemotePeer(peer: Peer) {
    if (this.snapshot.remotePeers.has(peer.id)) {
      return;
    }
    const nextRemotePeers = new Map(this.snapshot.remotePeers);
    nextRemotePeers.set(peer.id, peer);
    this.snapshot = {
      ...this.snapshot,
      remotePeers: nextRemotePeers,
    };
    this.notifyListeners();
  }

  private removeRemotePeer(peerId: PeerId) {
    if (!this.snapshot.remotePeers.has(peerId)) {
      return;
    }
    const nextRemotePeers = new Map(this.snapshot.remotePeers);
    nextRemotePeers.delete(peerId);
    this.snapshot = {
      ...this.snapshot,
      remotePeers: nextRemotePeers,
    };
    this.notifyListeners();
  }

  private setConnectionState(peerId: PeerId, state: RTCPeerConnectionState) {
    const nextStates = new Map(this.snapshot.connectionStates);
    nextStates.set(peerId, state);
    this.snapshot = {
      ...this.snapshot,
      connectionStates: nextStates,
    };
    this.notifyListeners();
  }

  private setRelayStatus(peerId: PeerId, status: CandidatePairType) {
    const nextRelays = new Map(this.snapshot.relayStatuses);
    nextRelays.set(peerId, status);
    this.snapshot = {
      ...this.snapshot,
      relayStatuses: nextRelays,
    };
    this.notifyListeners();
  }

  private removeConnectionState(peerId: PeerId) {
    if (!this.snapshot.connectionStates.has(peerId) && !this.snapshot.relayStatuses.has(peerId)) {
      return;
    }
    const nextStates = new Map(this.snapshot.connectionStates);
    nextStates.delete(peerId);
    const nextRelays = new Map(this.snapshot.relayStatuses);
    nextRelays.delete(peerId);
    this.snapshot = {
      ...this.snapshot,
      connectionStates: nextStates,
      relayStatuses: nextRelays,
    };
    this.notifyListeners();
  }

  private storeDataChannel(peerId: PeerId, label: string, channel: RTCDataChannel) {
    let peerChannels = this.dataChannels.get(peerId);
    if (!peerChannels) {
      peerChannels = new Map();
      this.dataChannels.set(peerId, peerChannels);
    }

    peerChannels.set(label, channel);
    dataChannelLogger.trace(`Stored data channel: ${label} for peer ${peerId}`);

    const waiterKey = `${peerId}:${label}`;
    const waiters = this.channelWaiters.get(waiterKey);
    if (waiters && waiters.length > 0) {
      this.channelWaiters.delete(waiterKey);
      for (const resolve of waiters) {
        resolve(channel);
      }
    }

    this.snapshot = {
      ...this.snapshot,
      channelsVersion: this.snapshot.channelsVersion + 1,
    };
    this.notifyListeners();
  }

  public getDataChannel = (peerId: PeerId, label: string): RTCDataChannel | null => {
    return this.dataChannels.get(peerId)?.get(label) ?? null;
  };

  public waitForChannel = (
    peerId: PeerId,
    label: string,
    timeoutMs = TIMEOUTS_MS.CHANNEL_WAIT_DEFAULT,
  ): Promise<RTCDataChannel> => {
    const existing = this.getDataChannel(peerId, label);
    if (existing && (existing.readyState === "open" || existing.readyState === "connecting")) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const waiterKey = `${peerId}:${label}`;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onResolved = (channel: RTCDataChannel) => {
        if (timer) clearTimeout(timer);
        resolve(channel);
      };

      if (!this.channelWaiters.has(waiterKey)) {
        this.channelWaiters.set(waiterKey, []);
      }
      this.channelWaiters.get(waiterKey)?.push(onResolved);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const list = this.channelWaiters.get(waiterKey);
          if (list) {
            this.channelWaiters.set(
              waiterKey,
              list.filter((w) => w !== onResolved),
            );
          }
          reject(new Error(`Timed out waiting for data channel "${label}" from peer ${peerId}`));
        }, timeoutMs);
      }
    });
  };

  public getPeerConnection = (peerId: PeerId): RTCPeerConnection | null => {
    return this.connections.get(peerId) ?? null;
  };

  public createPeerConnection = (peer: Peer): RTCPeerConnection | null => {
    if (!this.localPeer) {
      return null;
    }

    const existing = this.connections.get(peer.id);
    if (existing) {
      if (existing.connectionState !== "closed" && existing.connectionState !== "failed") {
        webrtcLogger.trace(`Reusing existing connection for peer: ${peer.name}`);
        return existing;
      }
      this.closePeerConnection(peer.id);
    }

    webrtcLogger.debug(`Creating peer connection for: ${peer.name}`);
    const peerConnection = this.rtcFactory(this.getConfiguration());
    this.connections.set(peer.id, peerConnection);

    peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        const iceCandidate: IceCandidateToSend = {
          candidate: event.candidate,
          target: peer,
        };
        this.socket.emit("ice-candidate", iceCandidate);
      }
    };

    peerConnection.onconnectionstatechange = () => {
      webrtcLogger.debug(`Connection state changed for ${peer.name}: ${peerConnection.connectionState}`);
      this.setConnectionState(peer.id, peerConnection.connectionState);

      if (peerConnection.connectionState === "connected") {
        void getSelectedCandidatePairType(peerConnection).then((pairType) => {
          this.setRelayStatus(peer.id, pairType);
        });
      } else if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
        const isRelay = this.snapshot.relayStatuses.get(peer.id) === "relay";
        void reportClientError({
          eventType: "iceconnectionstatechange",
          reason: `connectionState:${peerConnection.connectionState}`,
          isRelay,
          peerId: peer.id,
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnection.iceConnectionState === "failed") {
        const isRelay = this.snapshot.relayStatuses.get(peer.id) === "relay";
        void reportClientError({
          eventType: "iceconnectionstatechange",
          reason: `iceConnectionState:${peerConnection.iceConnectionState}`,
          isRelay,
          peerId: peer.id,
        });
      }
    };

    peerConnection.onicecandidateerror = (event: Event) => {
      const errorEvent = event as RTCPeerConnectionIceErrorEvent;
      const isRelay = this.snapshot.relayStatuses.get(peer.id) === "relay";
      void reportClientError({
        eventType: "icecandidateerror",
        reason: errorEvent.errorText || `Error ${errorEvent.errorCode}: ${errorEvent.url}`,
        isRelay,
        peerId: peer.id,
      });
    };

    peerConnection.ondatachannel = (event: RTCDataChannelEvent) => {
      const { channel: dataChannel } = event;
      const { label } = dataChannel;

      dataChannel.binaryType = "arraybuffer";

      dataChannelLogger.debug(`Received data channel from ${peer.name}: ${label}`);

      dataChannel.onerror = (error: Event) => {
        dataChannelLogger.error(`Data channel error from peer ${peer.name} on label ${label}:`, error);
      };

      this.storeDataChannel(peer.id, label, dataChannel);
    };

    return peerConnection;
  };

  public closePeerConnection = (peerId: PeerId): void => {
    const peerConnection = this.connections.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      this.connections.delete(peerId);
    }

    const channels = this.dataChannels.get(peerId);
    if (channels) {
      for (const channel of channels.values()) {
        channel.close();
      }
      this.dataChannels.delete(peerId);
    }

    this.pendingCandidates.delete(peerId);
    this.removeConnectionState(peerId);
  };

  private bufferIceCandidates(peer: Peer, candidate: RTCIceCandidateInit) {
    if (!this.pendingCandidates.has(peer.id)) {
      this.pendingCandidates.set(peer.id, []);
    }
    this.pendingCandidates.get(peer.id)?.push(candidate);
  }

  public initiateConnection = async (peer: Peer): Promise<void> => {
    if (!this.localPeer) {
      return;
    }

    const existing = this.connections.get(peer.id);
    if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") {
      webrtcLogger.trace(`Connection already exists for: ${peer.name}`);
      return;
    }

    this.setConnectionState(peer.id, "connecting");
    webrtcLogger.debug(`Initiating connection to: ${peer.name}`);
    const peerConnection = this.createPeerConnection(peer);
    if (!peerConnection) {
      webrtcLogger.error(`Failed to create peer connection for: ${peer.name}`);
      this.removeConnectionState(peer.id);
      return;
    }

    for (const label of this.channelLabels) {
      const dataChannel = peerConnection.createDataChannel(label, {
        ordered: true,
      });
      dataChannel.binaryType = "arraybuffer";

      dataChannel.onerror = (error: Event) => {
        dataChannelLogger.error(`Data channel error for ${peer.name} on label ${label}:`, error);
      };

      this.storeDataChannel(peer.id, label, dataChannel);
      dataChannelLogger.debug(`Created data channel: ${label} for peer ${peer.name}`);
    }

    const offerOptions: RTCOfferOptions = {
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    };

    try {
      const offer = await peerConnection.createOffer(offerOptions);
      const modifiedOffer = createSessionDescription({
        type: offer.type,
        sdp: offer.sdp ?? "",
      });

      await peerConnection.setLocalDescription(modifiedOffer);

      const offerData: OfferToSend = {
        to: peer,
        sdp: modifiedOffer,
      };
      webrtcLogger.debug(`Sending offer to: ${peer.name}`);
      this.socket.emit("offer", offerData);
    } catch (error) {
      webrtcLogger.error(`Failed to negotiate offer for ${peer.name}:`, error);
    }
  };

  public sendConnectionRequest = async (peer: Peer): Promise<void> => {
    if (!this.localPeer) return;

    socketLogger.debug(`Connecting directly to: ${peer.name}`);
    await this.initiateConnection(peer);
  };

  public connectToRoom = (roomId: string) => {
    const validation = validatePayload(ConnectToRoomSchema, roomId);
    if (!validation.success) {
      socketLogger.warn(`Invalid connect-to-room payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const validatedRoomId = validation.data;
    socketLogger.debug(`Connecting to room: ${validatedRoomId}`);
    this.socket.emit("connect-to-room", validatedRoomId);
  };

  public handleOffer = async (data: unknown) => {
    const validation = validatePayload(OfferSchema, data);
    if (!validation.success) {
      webrtcLogger.error(`Invalid offer payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const offer = validation.data;

    webrtcLogger.debug(`Received offer from: ${offer.from.name}`);
    this.addRemotePeer(offer.from);

    if (!this.localPeer) return;

    const peerConnection = this.createPeerConnection(offer.from);
    if (!peerConnection) {
      webrtcLogger.error(`Failed to create peer connection for offer from: ${offer.from.name}`);
      return;
    }

    if (peerConnection.signalingState !== "stable") {
      const isPolite = this.localPeer.id < offer.from.id;
      if (!isPolite) {
        webrtcLogger.debug(`Offer collision with ${offer.from.name}, ignoring offer because impolite`);
        return;
      }
      webrtcLogger.debug(`Offer collision with ${offer.from.name}, rolling back local offer because polite`);
      try {
        await peerConnection.setLocalDescription({ type: "rollback" });
      } catch (err) {
        webrtcLogger.warn("Rollback failed:", err);
      }
    }

    const offerSdpInit: RTCSessionDescriptionInit = {
      type: offer.sdp.type,
      ...(offer.sdp.sdp !== undefined && { sdp: offer.sdp.sdp }),
    };

    try {
      await peerConnection.setRemoteDescription(offerSdpInit);
    } catch (error) {
      webrtcLogger.error(`Failed to set remote description for offer from ${offer.from.name}:`, error);
      return;
    }

    const pendingCandidates = this.pendingCandidates.get(offer.from.id);
    if (pendingCandidates) {
      webrtcLogger.trace(`Adding ${pendingCandidates.length} buffered ICE candidates for ${offer.from.name}`);
      await Promise.all(
        pendingCandidates.map((candidate) =>
          peerConnection.addIceCandidate(candidate).catch((error: unknown) => {
            webrtcLogger.error("Error adding buffered ICE candidate:", error);
          }),
        ),
      );
      this.pendingCandidates.delete(offer.from.id);
    }

    try {
      const answerSdp = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answerSdp);

      const answer: AnswerToSend = { to: offer.from, sdp: answerSdp };
      webrtcLogger.debug(`Sending answer to: ${offer.from.name}`);
      this.socket.emit("answer", answer);
    } catch (error) {
      webrtcLogger.error(`Failed to create/set local answer for ${offer.from.name}:`, error);
    }
  };

  public handleAnswer = async (data: unknown) => {
    const validation = validatePayload(AnswerSchema, data);
    if (!validation.success) {
      webrtcLogger.error(`Invalid answer payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const answer = validation.data;

    webrtcLogger.debug(`Received answer from: ${answer.from.name}`);
    this.addRemotePeer(answer.from);

    const peerConnection = this.getPeerConnection(answer.from.id);
    if (!peerConnection) {
      webrtcLogger.error(`No peer connection found for answer from: ${answer.from.name}`);
      return;
    }

    const answerSdpInit: RTCSessionDescriptionInit = {
      type: answer.sdp.type,
      ...(answer.sdp.sdp !== undefined && { sdp: answer.sdp.sdp }),
    };

    try {
      await peerConnection.setRemoteDescription(answerSdpInit);
    } catch (error) {
      webrtcLogger.error(`Failed to set remote description for answer from ${answer.from.name}:`, error);
      return;
    }

    const pendingCandidates = this.pendingCandidates.get(answer.from.id);
    if (pendingCandidates) {
      webrtcLogger.trace(`Adding ${pendingCandidates.length} buffered ICE candidates for ${answer.from.name}`);
      await Promise.all(
        pendingCandidates.map((candidate) =>
          peerConnection.addIceCandidate(candidate).catch((error: unknown) => {
            webrtcLogger.error("Error adding buffered ICE candidate:", error);
          }),
        ),
      );
      this.pendingCandidates.delete(answer.from.id);
    }

    webrtcLogger.info(`WebRTC connection established with: ${answer.from.name}`);
  };

  public handleIceCandidate = (data: unknown) => {
    const validation = validatePayload(IceCandidateForPeerSchema, data);
    if (!validation.success) {
      webrtcLogger.error(`Invalid ICE candidate payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const candidateInfo = validation.data;
    this.addRemotePeer(candidateInfo.from);

    const peerConnection = this.getPeerConnection(candidateInfo.from.id);
    const candidateInit: RTCIceCandidateInit = {
      ...(candidateInfo.candidate.candidate !== undefined && {
        candidate: candidateInfo.candidate.candidate,
      }),
      ...(candidateInfo.candidate.sdpMid !== undefined && { sdpMid: candidateInfo.candidate.sdpMid }),
      ...(candidateInfo.candidate.sdpMLineIndex !== undefined && {
        sdpMLineIndex: candidateInfo.candidate.sdpMLineIndex,
      }),
      ...(candidateInfo.candidate.usernameFragment !== undefined && {
        usernameFragment: candidateInfo.candidate.usernameFragment,
      }),
    };

    if (peerConnection?.remoteDescription) {
      peerConnection.addIceCandidate(candidateInit).catch((error: unknown) => {
        webrtcLogger.error("Error adding ICE candidate:", error);
      });
      webrtcLogger.trace(`Added ICE candidate from: ${candidateInfo.from.name}`);
    } else {
      webrtcLogger.trace(`Buffering ICE candidate from: ${candidateInfo.from.name}`);
      this.bufferIceCandidates(candidateInfo.from, candidateInit);
    }
  };

  public handlePeerLeft = (data: unknown) => {
    const validation = validatePayload(PeerLeftDataSchema, data);
    if (!validation.success) {
      socketLogger.error(`Invalid peer-left payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const peer = validation.data;

    socketLogger.info(`Peer left: ${peer.id}`);
    this.removeRemotePeer(peer.id);

    // If the WebRTC connection is actively connected, do not abruptly tear it down on signaling blips.
    // The WebRTC connection state handlers will close it if the peer truly disconnects.
    const pc = this.connections.get(peer.id);
    if (!pc || (pc.connectionState !== "connected" && pc.iceConnectionState !== "connected")) {
      this.closePeerConnection(peer.id);
    }
  };

  public handleConnectionRequest = (data: unknown) => {
    const validation = validatePayload(ConnectionRequestSchema, data);
    if (!validation.success) {
      socketLogger.error(`Invalid connection request payload: ${formatValidationError(validation.error)}`);
      return;
    }
    const request = validation.data;
    if (!this.localPeer) {
      socketLogger.warn(`Received connection request from ${request.from.name} but localPeer is not set`);
      return;
    }

    socketLogger.debug(`Received connection request from: ${request.from.name} — connecting directly`);
    this.addRemotePeer(request.from);

    const existing = this.connections.get(request.from.id);
    if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") {
      webrtcLogger.trace(`Connection already exists for ${request.from.name}, skipping duplicate request`);
      return;
    }

    void this.initiateConnection(request.from);
  };

  public bindSocketEvents = () => {
    if (this.isDestroyed || this.isSocketBound) return;
    this.isSocketBound = true;
    this.socket.on("offer", this.handleOffer);
    this.socket.on("answer", this.handleAnswer);
    this.socket.on("ice-candidate", this.handleIceCandidate);
    this.socket.on("peer-left", this.handlePeerLeft);
    this.socket.on("connection-request", this.handleConnectionRequest);
  };

  public unbindSocketEvents = () => {
    if (!this.isSocketBound) return;
    this.isSocketBound = false;
    this.socket.off("offer", this.handleOffer);
    this.socket.off("answer", this.handleAnswer);
    this.socket.off("ice-candidate", this.handleIceCandidate);
    this.socket.off("peer-left", this.handlePeerLeft);
    this.socket.off("connection-request", this.handleConnectionRequest);
  };

  public closeAllConnections = (): void => {
    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.connections.clear();

    for (const channelMap of this.dataChannels.values()) {
      for (const channel of channelMap.values()) {
        channel.close();
      }
    }
    this.dataChannels.clear();
    this.pendingCandidates.clear();

    if (this.snapshot.connectionStates.size > 0 || this.snapshot.remotePeers.size > 0) {
      this.snapshot = {
        ...this.snapshot,
        connectionStates: new Map(),
        remotePeers: new Map(),
        channelsVersion: 0,
      };
      this.notifyListeners();
    }
  };

  public destroy = (): void => {
    this.unbindSocketEvents();
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.closeAllConnections();
    this.listeners.clear();
    this.channelWaiters.clear();
  };
}
