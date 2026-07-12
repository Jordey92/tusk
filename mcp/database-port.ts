export const parseDatabasePort = (rawPort?: string): number => {
  if (!rawPort) {
    return 5432;
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535");
  }

  return port;
};
