import { createHash } from "crypto";

/**
 * Calculate SHA256 checksum of a string
 */
export const calculateChecksum = (content: string): string => {
  return createHash("sha256").update(content).digest("hex");
};
