import { describe, expect, test } from "bun:test";
import { getCorrespondingFilename } from "./filename";

describe("getCorrespondingFilename", () => {
  describe("converting to up migration", () => {
    test("should convert down to up", () => {
      const result = getCorrespondingFilename("001_init.down.sql", "up");
      expect(result).toBe("001_init.up.sql");
    });

    test("should keep up as up", () => {
      const result = getCorrespondingFilename("002_users.up.sql", "up");
      expect(result).toBe("002_users.up.sql");
    });

    test("should handle timestamp-based filenames", () => {
      const result = getCorrespondingFilename("1234567890_create_posts.down.sql", "up");
      expect(result).toBe("1234567890_create_posts.up.sql");
    });

    test("should handle filenames with underscores", () => {
      const result = getCorrespondingFilename("003_add_user_email_index.down.sql", "up");
      expect(result).toBe("003_add_user_email_index.up.sql");
    });
  });

  describe("converting to down migration", () => {
    test("should convert up to down", () => {
      const result = getCorrespondingFilename("001_init.up.sql", "down");
      expect(result).toBe("001_init.down.sql");
    });

    test("should keep down as down", () => {
      const result = getCorrespondingFilename("002_users.down.sql", "down");
      expect(result).toBe("002_users.down.sql");
    });

    test("should handle timestamp-based filenames", () => {
      const result = getCorrespondingFilename("1234567890_create_posts.up.sql", "down");
      expect(result).toBe("1234567890_create_posts.down.sql");
    });

    test("should handle filenames with underscores", () => {
      const result = getCorrespondingFilename("003_add_user_email_index.up.sql", "down");
      expect(result).toBe("003_add_user_email_index.down.sql");
    });
  });

  describe("edge cases", () => {
    test("should handle filenames with dots in migration name", () => {
      const result = getCorrespondingFilename("001_v1.0_init.up.sql", "down");
      expect(result).toBe("001_v1.0_init.down.sql");
    });

    test("should only replace the .up.sql or .down.sql extension", () => {
      const result = getCorrespondingFilename("001_test.up.down.sql", "down");
      // This tests that it only replaces the final .down.sql
      expect(result).toBe("001_test.up.down.sql");
    });

    test("should handle zero-padded timestamps", () => {
      const result = getCorrespondingFilename("0000000000000_initial.up.sql", "down");
      expect(result).toBe("0000000000000_initial.down.sql");
    });
  });
});
