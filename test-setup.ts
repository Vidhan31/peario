if (typeof (globalThis as unknown as { Bun: unknown }).Bun === "undefined") {
  (globalThis as unknown as { Bun: unknown }).Bun = {
    env: process.env,
    randomUUIDv7: () => {
      // RFC 9562 UUIDv7 mock for testing environments: 8-4-4-4-12 hex with version 7
      const now = Date.now();
      const timeHex = now.toString(16).padStart(12, "0");
      const part1 = timeHex.slice(0, 8);
      const part2 = timeHex.slice(8, 12);
      return `${part1}-${part2}-7000-8000-${crypto.randomUUID().slice(24)}`;
    },
    file: () => ({ size: 0 }),
  };
}
