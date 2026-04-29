import { describe, expect, test } from "bun:test";
import { isMissingPathError } from "./fs-errors";

const createErrnoError = (code: string) => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

describe("filesystem error helpers", () => {
  test("classifies only missing path errors as missing", () => {
    expect(isMissingPathError(createErrnoError("ENOENT"))).toBe(true);
    expect(isMissingPathError(createErrnoError("ENOTDIR"))).toBe(true);
    expect(isMissingPathError(createErrnoError("EACCES"))).toBe(false);
    expect(isMissingPathError(new Error("plain"))).toBe(false);
  });
});
