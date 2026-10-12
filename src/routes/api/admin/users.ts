import { createFileRoute } from "@tanstack/react-router";
import { requireAdminAuth } from "@/server/auth";
import { listUsersDb } from "@/server/db";

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const url = new URL(request.url);
          const q = url.searchParams.get("q") || undefined;
          const users = await listUsersDb(q);
          return Response.json({ success: true, users });
        } catch (err) {
          console.error("Failed to list users:", err);
          return Response.json(
            { success: false, error: "Failed to list users." },
            { status: 500 },
          );
        }
      },
    },
  },
});
