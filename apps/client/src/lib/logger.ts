import { type ILogObj, Logger } from "tslog";

const isDevelopment = import.meta.env.DEV;

/**
 * Main logger instance for the Pear client
 * - Pretty output in development mode for better readability
 * - Hidden output in production (logs suppressed)
 * - Full log levels in development for debugging
 */
export const logger = new Logger<ILogObj>({
  name: "Pear",
  type: isDevelopment ? "pretty" : "hidden",
  minLevel: isDevelopment ? 0 : 6, // silly in dev, fatal only in prod (effectively hidden)
  prettyLogTimeZone: "local",
  prettyLogTemplate: "{{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{name}}]\t",
  stylePrettyLogs: true,
  prettyLogStyles: {
    logLevelName: {
      "*": ["bold", "black", "bgWhiteBright", "dim"],
      SILLY: ["bold", "white"],
      TRACE: ["bold", "whiteBright"],
      DEBUG: ["bold", "green"],
      INFO: ["bold", "blue"],
      WARN: ["bold", "yellow"],
      ERROR: ["bold", "red"],
      FATAL: ["bold", "redBright"],
    },
    name: ["white", "bold"],
  },
  maskValuesOfKeys: ["password", "token", "secret", "authorization"],
  maskValuesOfKeysCaseInsensitive: true,
});

export const socketLogger = logger.getSubLogger({ name: "Socket" });

export const webrtcLogger = logger.getSubLogger({ name: "WebRTC" });

export const fileLogger = logger.getSubLogger({ name: "File" });

export const dataChannelLogger = logger.getSubLogger({ name: "DataChannel" });
