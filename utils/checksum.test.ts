import { describe, expect, test } from "bun:test";
import { calculateChecksum } from "./checksum";

describe("calculateChecksum", () => {
  test("should generate consistent SHA256 hash for same input", () => {
    const content = "SELECT * FROM users;";
    const hash1 = calculateChecksum(content);
    const hash2 = calculateChecksum(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 produces 64 hex characters
  });

  test("should generate different hashes for different inputs", () => {
    const content1 = "SELECT * FROM users;";
    const content2 = "SELECT * FROM posts;";

    const hash1 = calculateChecksum(content1);
    const hash2 = calculateChecksum(content2);

    expect(hash1).not.toBe(hash2);
  });

  test("should handle empty string", () => {
    const hash = calculateChecksum("");

    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64);
    // Empty string SHA256 hash
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("should be case sensitive", () => {
    const hash1 = calculateChecksum("CREATE TABLE users");
    const hash2 = calculateChecksum("create table users");

    expect(hash1).not.toBe(hash2);
  });

  test("should handle multi-line SQL", () => {
    const sql = `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255)
      );
    `;

    const hash = calculateChecksum(sql);

    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64);
  });

  test("should be deterministic across runs", () => {
    const content = "DROP TABLE users CASCADE;";
    const expectedHash = calculateChecksum(content);

    // Run multiple times
    for (let i = 0; i < 10; i++) {
      expect(calculateChecksum(content)).toBe(expectedHash);
    }
  });
});
