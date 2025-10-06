type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: any;
}

interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  return ["debug", "info", "warn", "error"].includes(level) ? level : "info";
};

const shouldLog = (level: LogLevel, currentLevel: LogLevel): boolean => {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
};

const formatMessage = (level: LogLevel, message: string, context?: LogContext): string => {
  const timestamp = new Date().toISOString();
  const baseMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (context && Object.keys(context).length > 0) {
    return `${baseMessage} ${JSON.stringify(context)}`;
  }

  return baseMessage;
};

const createLogger = (level: LogLevel = getLogLevel()): Logger => ({
  debug: (message: string, context?: LogContext) => {
    if (shouldLog("debug", level)) {
      console.log(formatMessage("debug", message, context));
    }
  },

  info: (message: string, context?: LogContext) => {
    if (shouldLog("info", level)) {
      console.log(formatMessage("info", message, context));
    }
  },

  warn: (message: string, context?: LogContext) => {
    if (shouldLog("warn", level)) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  error: (message: string, context?: LogContext) => {
    if (shouldLog("error", level)) {
      console.error(formatMessage("error", message, context));
    }
  },
});

export const logger = createLogger();
export { createLogger };
export type { Logger, LogLevel, LogContext };