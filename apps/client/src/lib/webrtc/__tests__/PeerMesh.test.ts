import type { Offer, Peer, PeerId } from "@peario/shared";

import { beforeEach, describe, expect, it } from "vitest";

import { assertDefined, FakeRTCDataChannel, FakeRTCPeerConnection, FakeSocket } from "@/test/fakes";

import { PeerMesh } from "../PeerMesh";

describe("PeerMesh", () => {
  let fakeSocket: FakeSocket;
  let localPeer: Peer;
  let remotePeer1: Peer;
  let remotePeer2: Peer;
  let createdPCs: FakeRTCPeerConnection[];

  beforeEach(() => {
    fakeSocket = new FakeSocket();
    createdPCs = [];

    localPeer = {
      id: "01920000-0000-7000-8000-000000000002" as PeerId,
      name: "Alice",
      timestamp: new Date().toISOString(),
    };

    remotePeer1 = {
      id: "01920000-0000-7000-8000-000000000001" as PeerId, // Lexicographically lower than Alice
      name: "Bob",
      timestamp: new Date().toISOString(),
    };

    remotePeer2 = {
      id: "01920000-0000-7000-8000-000000000003" as PeerId, // Lexicographically higher than Alice
      name: "Charlie",
      timestamp: new Date().toISOString(),
    };
  });

  function createMesh() {
    return new PeerMesh({
      socket: fakeSocket.asSocket(),
      localPeer,
      rtcFactory: () => {
        const pc = new FakeRTCPeerConnection();
        createdPCs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
      getIceServers: () => Promise.resolve([]),
    });
  }

  it("exposes initial snapshot with empty connection states", () => {
    const mesh = createMesh();
    const snapshot = mesh.getSnapshot();
    expect(snapshot.connectionStates.size).toBe(0);
    expect(snapshot.remotePeers.size).toBe(0);
  });

  it("initiates connection and creates all configured data channels", async () => {
    const mesh = createMesh();
    await mesh.initiateConnection(remotePeer1);

    expect(createdPCs.length).toBe(1);
    assertDefined(createdPCs[0]);
    const pc = createdPCs[0];
    expect(pc.createDataChannel).toHaveBeenCalledWith("file", { ordered: true });
    expect(pc.createDataChannel).toHaveBeenCalledWith("file-ctrl", { ordered: true });
    expect(pc.createDataChannel).toHaveBeenCalledWith("file-data", { ordered: true });

    const offerEmit = fakeSocket.emitted.find((e) => e.event === "offer");
    expect(offerEmit).toBeDefined();
    assertDefined(offerEmit);
    const offerData = offerEmit.data as Offer;
    expect(offerData.to.id).toBe(remotePeer1.id);
  });

  it("resolves waitForChannel when channel is received via ondatachannel", async () => {
    const mesh = createMesh();
    const pc = mesh.createPeerConnection(remotePeer1);
    assertDefined(pc);

    const channelPromise = mesh.waitForChannel(remotePeer1.id, "file-ctrl", 1000);

    const mockChannel = new FakeRTCDataChannel("file-ctrl");
    const createdPC = createdPCs[createdPCs.length - 1];
    assertDefined(createdPC);
    createdPC.triggerDataChannel(mockChannel);

    const resolved = await channelPromise;
    expect(resolved?.label).toBe(mockChannel.label);
  });

  it("handles incoming connection request and directly initiates connection", async () => {
    const mesh = createMesh();

    await fakeSocket.trigger("connection-request", {
      from: remotePeer1,
      to: localPeer,
    });

    const offerEmit = fakeSocket.emitted.find((e) => e.event === "offer");
    expect(offerEmit).toBeDefined();
    assertDefined(offerEmit);
    const offerData = offerEmit.data as Offer;
    expect(offerData.to.id).toBe(remotePeer1.id);
    expect(mesh.getSnapshot().remotePeers.has(remotePeer1.id)).toBe(true);
  });

  it("sendConnectionRequest directly initiates WebRTC connection", async () => {
    const mesh = createMesh();

    await mesh.sendConnectionRequest(remotePeer2);

    const offerEmit = fakeSocket.emitted.find((e) => e.event === "offer");
    expect(offerEmit).toBeDefined();
    assertDefined(offerEmit);
    const offerData = offerEmit.data as Offer;
    expect(offerData.to.id).toBe(remotePeer2.id);
  });

  it("ignores duplicate connection request for already-connected peer", async () => {
    const mesh = createMesh();
    // Already have a connection open with remotePeer2
    mesh.createPeerConnection(remotePeer2);

    await fakeSocket.trigger("connection-request", {
      from: remotePeer2,
      to: localPeer,
    });

    // Should not create a second offer
    const offerEmits = fakeSocket.emitted.filter((e) => e.event === "offer");
    expect(offerEmits.length).toBe(0);
  });

  it("buffers ICE candidates arriving before remote description and flushes on offer", async () => {
    const mesh = createMesh();
    expect(mesh).toBeDefined();

    await fakeSocket.trigger("ice-candidate", {
      candidate: { candidate: "candidate:1 1 UDP 1694498815 192.0.2.1 50000 typ host" },
      from: remotePeer1,
      target: localPeer,
    });

    await fakeSocket.trigger("offer", {
      from: remotePeer1,
      to: localPeer,
      sdp: { type: "offer", sdp: "v=0\r\no=bob" },
    });

    assertDefined(createdPCs[0]);
    const pc = createdPCs[0];
    expect(pc).toBeDefined();
    expect(pc.setRemoteDescription).toHaveBeenCalled();
    expect(pc.addIceCandidate).toHaveBeenCalled();
  });

  it("supports unbindSocketEvents and bindSocketEvents lifecycle (StrictMode remount simulation)", async () => {
    const mesh = createMesh();

    mesh.unbindSocketEvents();

    // localPeer is answerer for remotePeer1 (lower ID) — even if bound, no offer expected
    await fakeSocket.trigger("connection-request", {
      from: remotePeer1,
      to: localPeer,
    });
    // Unbound — remote peer should not be registered
    expect(mesh.getSnapshot().remotePeers.size).toBe(0);

    mesh.bindSocketEvents();

    await fakeSocket.trigger("connection-request", {
      from: remotePeer1,
      to: localPeer,
    });
    // Now bound — remote peer should be registered
    expect(mesh.getSnapshot().remotePeers.has(remotePeer1.id)).toBe(true);
  });

  it("unbinds listeners and closes all connections on destroy", () => {
    const mesh = createMesh();
    mesh.createPeerConnection(remotePeer1);
    assertDefined(createdPCs[0]);
    const pc = createdPCs[0];

    mesh.destroy();

    expect(pc.close).toHaveBeenCalled();
    expect(mesh.getPeerConnection(remotePeer1.id)).toBeNull();
    expect(mesh.destroyed).toBe(true);
  });

  it("does not re-bind socket events if mesh is destroyed", async () => {
    const mesh = createMesh();
    mesh.destroy();

    mesh.bindSocketEvents();

    await fakeSocket.trigger("connection-request", {
      from: remotePeer1,
      to: localPeer,
    });
    expect(mesh.getSnapshot().remotePeers.size).toBe(0);
  });

  it("closeAllConnections closes connections and resets snapshot without destroying instance", () => {
    const mesh = createMesh();
    mesh.createPeerConnection(remotePeer1);
    assertDefined(createdPCs[0]);
    const pc = createdPCs[0];

    mesh.closeAllConnections();

    expect(pc.close).toHaveBeenCalled();
    expect(mesh.getPeerConnection(remotePeer1.id)).toBeNull();
    expect(mesh.destroyed).toBe(false);
    expect(mesh.getSnapshot().connectionStates.size).toBe(0);
  });

  it("preserves this binding when methods are destructured and called as free functions", async () => {
    const mesh = createMesh();
    const { getDataChannel, waitForChannel, getPeerConnection, closePeerConnection } = mesh;

    expect(getDataChannel(remotePeer1.id, "file-ctrl")).toBeNull();
    expect(getPeerConnection(remotePeer1.id)).toBeNull();

    const pc = mesh.createPeerConnection(remotePeer1);
    assertDefined(pc);
    const waitPromise = waitForChannel(remotePeer1.id, "file-ctrl", 100);
    const mockChannel = new FakeRTCDataChannel("file-ctrl");
    const createdPC = createdPCs[createdPCs.length - 1];
    assertDefined(createdPC);
    createdPC.triggerDataChannel(mockChannel);

    const resolved = await waitPromise;
    expect(resolved?.label).toBe(mockChannel.label);

    closePeerConnection(remotePeer1.id);
    expect(createdPC.close).toHaveBeenCalled();
  });
});
