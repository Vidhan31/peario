import { useState } from "react";
import { FiUserPlus } from "react-icons/fi";

interface JoinRoomFormProps {
  onJoin: (roomId: string) => void;
}

export const JoinRoomForm = ({ onJoin }: JoinRoomFormProps) => {
  const [targetRoomId, setTargetRoomId] = useState("");

  const handleJoin = () => {
    if (targetRoomId.trim()) {
      onJoin(targetRoomId.trim().toUpperCase());
      setTargetRoomId("");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-5 backdrop-blur-sm transition-all hover:bg-muted/60 hover:shadow-md hover:shadow-primary/5">
      <div className="mb-4 flex items-center gap-2 text-primary">
        <FiUserPlus aria-hidden="true" />
        <h2 className="font-semibold text-sm uppercase tracking-wider">Connect to Room</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleJoin();
        }}
        className="flex gap-2"
      >
        <div className="flex-1">
          <label htmlFor="join-room-input" className="sr-only">
            Room ID
          </label>
          <input
            id="join-room-input"
            type="text"
            value={targetRoomId}
            onChange={(e) => {
              setTargetRoomId(e.target.value.toUpperCase());
            }}
            aria-label="Room ID"
            placeholder="Room ID"
            className="w-full rounded-lg border border-border bg-background/50 px-4 py-2 text-foreground placeholder-muted-foreground transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            maxLength={6}
          />
        </div>
        <button
          type="submit"
          disabled={!targetRoomId.trim()}
          aria-label="Join room"
          className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Join
        </button>
      </form>
    </div>
  );
};

JoinRoomForm.displayName = "JoinRoomForm";
