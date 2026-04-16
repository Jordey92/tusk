import { dirname } from "path";
import { fileURLToPath } from "url";

export const getCurrentDir = (): string => {
  if (typeof import.meta.dir !== "undefined") {
    return import.meta.dir;
  }

  return dirname(fileURLToPath(import.meta.url));
};
