import { describe, expect, test, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { createLogger, type LogLevel } from "./logger";

describe("Logger", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("log levels", () => {
    test("debug level should log all messages", () => {
      const logger = createLogger("debug");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test("info level should log info, warn, and error", () => {
      const logger = createLogger("info");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1); // only info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test("warn level should log warn and error only", () => {
      const logger = createLogger("warn");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test("error level should log error only", () => {
      const logger = createLogger("error");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("message formatting", () => {
    test("should include timestamp in message", () => {
      const logger = createLogger("info");

      logger.info("test message");

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    test("should include log level in message", () => {
      const logger = createLogger("debug");

      logger.debug("debug test");
      logger.info("info test");

      const debugCall = consoleLogSpy.mock.calls[0][0] as string;
      const infoCall = consoleLogSpy.mock.calls[1][0] as string;

      expect(debugCall).toContain("[DEBUG]");
      expect(infoCall).toContain("[INFO]");
    });

    test("should include the message text", () => {
      const logger = createLogger("info");

      logger.info("This is a test message");

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain("This is a test message");
    });

    test("should format context as JSON", () => {
      const logger = createLogger("info");
      const context = { userId: 123, action: "login" };

      logger.info("User action", context);

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('{"userId":123,"action":"login"}');
    });

    test("should omit context when empty", () => {
      const logger = createLogger("info");

      logger.info("Message without context");

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).not.toContain("{}");
      expect(call).toContain("Message without context");
    });

    test("should handle complex context objects", () => {
      const logger = createLogger("info");
      const context = {
        user: { id: 1, name: "Test" },
        metadata: { source: "api", version: "1.0" },
      };

      logger.info("Complex context", context);

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('"id":1');
      expect(call).toContain('"name":"Test"');
      expect(call).toContain('"source":"api"');
    });
  });

  describe("different log methods", () => {
    test("debug should use console.log", () => {
      const logger = createLogger("debug");

      logger.debug("debug message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(0);
    });

    test("info should use console.log", () => {
      const logger = createLogger("info");

      logger.info("info message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(0);
    });

    test("warn should use console.warn", () => {
      const logger = createLogger("warn");

      logger.warn("warn message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(0);
    });

    test("error should use console.error", () => {
      const logger = createLogger("error");

      logger.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("context handling", () => {
    test("should handle undefined context", () => {
      const logger = createLogger("info");

      logger.info("message", undefined);

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain("message");
      expect(call).not.toContain("undefined");
    });

    test("should handle null values in context", () => {
      const logger = createLogger("info");

      logger.info("message", { value: null });

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('"value":null');
    });

    test("should handle array values in context", () => {
      const logger = createLogger("info");

      logger.info("message", { items: [1, 2, 3] });

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('"items":[1,2,3]');
    });

    test("should handle boolean values in context", () => {
      const logger = createLogger("info");

      logger.info("message", { success: true, failed: false });

      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain('"success":true');
      expect(call).toContain('"failed":false');
    });
  });

  describe("log level filtering", () => {
    test("should respect log level hierarchy", () => {
      const levels: LogLevel[] = ["debug", "info", "warn", "error"];

      levels.forEach((level) => {
        consoleLogSpy.mockClear();
        consoleWarnSpy.mockClear();
        consoleErrorSpy.mockClear();

        const logger = createLogger(level);

        logger.debug("test");
        logger.info("test");
        logger.warn("test");
        logger.error("test");

        const totalCalls =
          consoleLogSpy.mock.calls.length +
          consoleWarnSpy.mock.calls.length +
          consoleErrorSpy.mock.calls.length;

        // Each level should log its level and all higher levels
        const expectedCalls = 4 - levels.indexOf(level);
        expect(totalCalls).toBe(expectedCalls);
      });
    });
  });
});
