import type { StructuredContext } from "../types/structured.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface Logger {
  debug(message: string, context?: StructuredContext): void;
  info(message: string, context?: StructuredContext): void;
  warn(message: string, context?: StructuredContext): void;
  error(message: string, context?: StructuredContext): void;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  return ["debug", "info", "warn", "error"].includes(level) ? level : "info";
};

const shouldLog = (level: LogLevel, currentLevel: LogLevel): boolean => {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
};

const formatMessage = (level: LogLevel, message: string, context?: StructuredContext): string => {
  const timestamp = new Date().toISOString();
  const baseMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (context && Object.keys(context).length > 0) {
    return `${baseMessage} ${JSON.stringify(context)}`;
  }

  return baseMessage;
};

const createLogger = (level?: LogLevel): Logger => ({
  debug: (message: string, context?: StructuredContext) => {
    if (shouldLog("debug", level ?? getLogLevel())) {
      console.log(formatMessage("debug", message, context));
    }
  },

  info: (message: string, context?: StructuredContext) => {
    if (shouldLog("info", level ?? getLogLevel())) {
      console.log(formatMessage("info", message, context));
    }
  },

  warn: (message: string, context?: StructuredContext) => {
    if (shouldLog("warn", level ?? getLogLevel())) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  error: (message: string, context?: StructuredContext) => {
    if (shouldLog("error", level ?? getLogLevel())) {
      console.error(formatMessage("error", message, context));
    }
  },
});

export const logger = createLogger();
export { createLogger };
