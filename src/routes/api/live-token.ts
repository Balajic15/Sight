import { createFileRoute } from "@tanstack/react-router";
import { requireSessionAuth } from "@/server/auth";

export const Route = createFileRoute("/api/live-token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        const apiKey = process.env["GOOGLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Google API key is not configured" }, { status: 500 });
        }

        // Return token/key safely to authorized session for direct WebSocket
        return Response.json({
          success: true,
          apiKey,
          model: "models/gemini-3.8-live",
        });
      },
    },
  },
});
