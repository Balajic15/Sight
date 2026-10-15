import { createFileRoute } from "@tanstack/react-router";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

export const Route = createFileRoute("/api/live-token")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        const serverKey = process.env["GOOGLE_API_KEY"];
        if (!serverKey) {
          return corsJson(
            { error: "Google Live Assistant service is not configured." },
            { status: 503 },
          );
        }

        const model =
          process.env["GEMINI_LIVE_MODEL"] ||
          "models/gemini-3.1-flash-live-preview";

        // For direct WebSockets, generate an authenticated bridge URL or scoped token
        // In high-security environments, point client to your production WebSocket proxy: /api/live
        return corsJson({
          success: true,
          apiKey: serverKey, // Replace with signed ephemeral token when using Vertex AI / Cloud IAM
          model,
          expiresIn: 3600,
          userId: auth.session.userId,
        });
      },
    },
  },
});
