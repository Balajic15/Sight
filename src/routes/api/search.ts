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
        const rawQuery = url.searchParams.get("q")?.trim() || "";
        const query = rawQuery.slice(0, 200).replace(/[^\p{L}\p{N}\s\-_@.]/gu, "");

        const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

        if (!query) {
          return corsJson(
            {
              success: true,
              query: "",
              results: { conversations: [], messages: [], media: [] },
            },
            {
              headers: { "Cache-Control": "private, no-cache, no-store" },
            },
          );
        }

        try {
          const results = await searchUserContentDb(auth.session.userId, query, limit);
          return corsJson(
            {
              success: true,
              query,
              results: results || { conversations: [], messages: [], media: [] },
            },
            {
              headers: { "Cache-Control": "private, no-cache, no-store" },
            },
          );
        } catch (error) {
          console.error("[api/search] Search query error:", error);
          return corsJson({ success: false, error: "Failed to execute search." }, { status: 500 });
        }
      },
    },
  },
});
