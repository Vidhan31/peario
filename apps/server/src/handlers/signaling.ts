import type { Answer, IceCandidateForPeer, Offer, PeerServer, PeerSocket } from "../types";

import {
  AnswerIncomingSchema,
  formatValidationError,
  IceCandidateIncomingSchema,
  OfferIncomingSchema,
  validatePayload,
} from "../types";
import { signalingLogger } from "../utils/logger";
import { getAuthenticatedPeer, getSocketIdByPeerId } from "../utils/peer";

export function handleOffer(io: PeerServer, socket: PeerSocket, data: unknown): void {
  const trustedFrom = getAuthenticatedPeer(socket);
  if (!trustedFrom) {
    signalingLogger.warn(`Unauthenticated socket ${socket.id} tried to send offer`);
    return;
  }

  const validation = validatePayload(OfferIncomingSchema, data);
  if (!validation.success) {
    signalingLogger.warn(`Invalid offer payload from ${socket.id}: ${formatValidationError(validation.error)}`);
    return;
  }
  const offer = validation.data;

  const targetSocketId = getSocketIdByPeerId(offer.to.id);
  if (!targetSocketId) {
    signalingLogger.debug(`Target peer ${offer.to.id} not found in mapping`);
    return;
  }

  const trustedOffer: Offer = {
    from: trustedFrom,
    to: offer.to,
    sdp: offer.sdp,
  };

  signalingLogger.debug(`Offer: ${trustedFrom.name} → ${offer.to.name}`);
  io.to(targetSocketId).emit("offer", trustedOffer);
}

export function handleAnswer(io: PeerServer, socket: PeerSocket, data: unknown): void {
  const trustedFrom = getAuthenticatedPeer(socket);
  if (!trustedFrom) {
    signalingLogger.warn(`Unauthenticated socket ${socket.id} tried to send answer`);
    return;
  }

  const validation = validatePayload(AnswerIncomingSchema, data);
  if (!validation.success) {
    signalingLogger.warn(`Invalid answer payload from ${socket.id}: ${formatValidationError(validation.error)}`);
    return;
  }
  const answer = validation.data;

  const targetSocketId = getSocketIdByPeerId(answer.to.id);
  if (!targetSocketId) {
    signalingLogger.debug(`Target peer ${answer.to.id} not found in mapping`);
    return;
  }

  const trustedAnswer: Answer = {
    from: trustedFrom,
    to: answer.to,
    sdp: answer.sdp,
  };

  signalingLogger.debug(`Answer: ${trustedFrom.name} → ${answer.to.name}`);
  io.to(targetSocketId).emit("answer", trustedAnswer);
}

export function handleIceCandidate(io: PeerServer, socket: PeerSocket, data: unknown): void {
  const trustedFrom = getAuthenticatedPeer(socket);
  if (!trustedFrom) {
    signalingLogger.warn(`Unauthenticated socket ${socket.id} tried to send ICE candidate`);
    return;
  }

  const validation = validatePayload(IceCandidateIncomingSchema, data);
  if (!validation.success) {
    signalingLogger.warn(`Invalid ICE candidate payload from ${socket.id}: ${formatValidationError(validation.error)}`);
    return;
  }
  const iceData = validation.data;

  const targetSocketId = getSocketIdByPeerId(iceData.target.id);
  if (!targetSocketId) {
    signalingLogger.debug(`Target peer ${iceData.target.id} not found in mapping`);
    return;
  }

  const trustedIceData: IceCandidateForPeer = {
    candidate: iceData.candidate,
    from: trustedFrom,
    target: iceData.target,
  };

  signalingLogger.trace(`ICE: ${trustedFrom.name} → ${iceData.target.name}`);
  io.to(targetSocketId).emit("ice-candidate", trustedIceData);
}
