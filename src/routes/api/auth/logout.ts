import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, corsJson, corsOptions } from "@/server/auth";
import { revokeSessionDb } from "@/server/db";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      POST: async ({ request }) => {
        const token = extractBearerToken(request);
        if (token) {
          await revokeSessionDb(token);
        }
        return corsJson({ success: true });
      },
    },
  },
});
