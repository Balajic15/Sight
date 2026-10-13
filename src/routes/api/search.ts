import { createFileRoute } from "@tanstack/react-router";
import { searchUserContentDb } from "@/server/db";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        const url = new URL(request.url);
        const query = url.searchParams.get("q")?.trim() || "";
        const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

        if (!query) {
          return corsJson({
            success: true,
            results: {
              conversations: [],
              messages: [],
              media: [],
            },
          });
        }

        try {
          const results = await searchUserContentDb(auth.session.userId, query, limit);
          return corsJson({
            success: true,
            results,
          });
        } catch (error) {
          console.error("[api/search] Search query error:", error);
          return corsJson(
            { success: false, error: "Failed to execute search" },
            { status: 500 }
          );
        }
      },
    },
  },
});
