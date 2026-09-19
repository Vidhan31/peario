import { type ILogObj, Logger } from "tslog";

const isDevelopment = (typeof Bun !== "undefined" ? Bun.env.NODE_ENV : process.env.NODE_ENV) !== "production";

/**
 * Main logger instance for the signaling server
 * - Pretty output in development mode for better readability
 * - JSON output in production for log aggregation services
 * - Hides log position in production for better performance
 */
export const logger = new Logger<ILogObj>(
  {
    name: "PearServer",
    type: isDevelopment ? "pretty" : "json",
    minLevel: isDevelopment ? 0 : 3, // silly in dev, info in prod
    hideLogPositionForProduction: !isDevelopment,
    prettyLogTimeZone: "local",
    prettyLogTemplate: "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{name}}]\t",
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
  },
  {
    // Fix tslog serialization of Bun/Node internals by clean object formatting
    colorize: isDevelopment,
  },
);

export const socketLogger = logger.getSubLogger({ name: "Socket" });

export const signalingLogger = logger.getSubLogger({ name: "Signaling" });

export const connectionLogger = logger.getSubLogger({ name: "Connection" });

export const identityLogger = logger.getSubLogger({ name: "Identity" });

export const rateLimitLogger = logger.getSubLogger({ name: "RateLimit" });
