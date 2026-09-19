import { useSyncExternalStore } from "react";

import { socket } from "../lib/SocketService";

function subscribe(callback: () => void) {
  socket.on("connect", callback);
  socket.on("disconnect", callback);

  return () => {
    socket.off("connect", callback);
    socket.off("disconnect", callback);
  };
}

function getSnapshot() {
  return socket.connected;
}

export function useSocketStatus() {
  const isConnected = useSyncExternalStore(subscribe, getSnapshot);
  return isConnected;
}
