import { createFileRoute } from "@tanstack/react-router";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

export const Route = createFileRoute("/api/live-token")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        const apiKey = process.env["GOOGLE_API_KEY"];
        if (!apiKey) {
          return corsJson({ error: "Google API key is not configured" }, { status: 500 });
        }

        const model = process.env["GEMINI_LIVE_MODEL"] || "models/gemini-3.1-flash-live-preview";

        // Return token/key safely to authorized session for direct WebSocket
        return corsJson({
          success: true,
          apiKey,
          model,
        });
      },
    },
  },
});
