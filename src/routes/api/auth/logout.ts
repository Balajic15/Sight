import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken } from "@/server/auth";
import { revokeSessionDb } from "@/server/db";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = extractBearerToken(request);
        if (token) {
          await revokeSessionDb(token);
        }
        return Response.json({ success: true });
      },
    },
  },
});
