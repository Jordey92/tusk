import { dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Runtime-agnostic directory resolution
 * Works with both Bun and Node.js
 */
export const getCurrentDir = (): string => {
  // Bun provides import.meta.dir
  if (typeof import.meta.dir !== 'undefined') {
    return import.meta.dir;
  }

  // Node.js requires fileURLToPath and dirname
  return dirname(fileURLToPath(import.meta.url));
};
