const isErrnoException = (
  error: unknown
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export const isMissingPathError = (error: unknown) =>
  isErrnoException(error) &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");
