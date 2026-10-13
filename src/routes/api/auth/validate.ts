import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, corsJson, corsOptions } from "@/server/auth";
import { validateSessionTokenDb } from "@/server/db";

export const Route = createFileRoute("/api/auth/validate")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const token = extractBearerToken(request);
        if (!token) {
          return corsJson(
            {
              valid: false,
              reason: "missing",
              error: "Missing authorization token.",
            },
            { status: 401 },
          );
        }

        const validation = await validateSessionTokenDb(token);
        if (!validation.valid) {
          const isExpired = validation.reason === "expired";
          return corsJson(
            {
              valid: false,
              reason: validation.reason,
              error: isExpired
                ? "Your access has expired. Enter a new Invitation Key to continue."
                : "Session is invalid or has been revoked.",
              expiresAt: validation.session?.expiresAt || null,
            },
            { status: 401 },
          );
        }

        return corsJson({
          valid: true,
          userId: validation.session?.userId || null,
          expiresAt: validation.session?.expiresAt || null,
          remainingMs: validation.session?.remainingMs ?? null,
          isAdmin: validation.session?.isAdmin ?? false,
        });
      },
    },
  },
});
