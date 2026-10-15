import { createFileRoute } from "@tanstack/react-router";
import { validateSessionTokenDb } from "@/server/db";
import { extractBearerToken, corsJson, corsOptions } from "@/server/auth";

export const Route = createFileRoute("/api/validate")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      POST: async ({ request }) => {
        const token = extractBearerToken(request);
        if (!token) {
          return corsJson({ valid: false, error: "Missing session token." }, { status: 401 });
        }
        const validation = await validateSessionTokenDb(token);
        if (!validation.valid || !validation.session) {
          return corsJson({ valid: false, reason: validation.reason }, { status: 401 });
        }
        return corsJson({
          valid: true,
          userId: validation.session.userId,
          isAdmin: validation.session.isAdmin,
          expiresAt: validation.session.expiresAt,
          remainingMs: validation.session.remainingMs,
        });
      },
    },
  },
});
