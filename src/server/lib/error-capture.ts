let lastError: Error | null = null;

if (typeof process !== "undefined") {
  process.on("uncaughtException", (err) => {
    lastError = err;
  });
  process.on("unhandledRejection", (reason) => {
    lastError = reason instanceof Error ? reason : new Error(String(reason));
  });
}

export function recordCapturedError(err: unknown) {
  lastError = err instanceof Error ? err : new Error(String(err));
}

export function consumeLastCapturedError(): Error | null {
  const err = lastError;
  lastError = null;
  return err;
}
