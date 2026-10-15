import { createFileRoute } from "@tanstack/react-router";
import { requireAdminAuth, corsJson, corsOptions } from "@/server/auth";
import { listUsersDb } from "@/server/db";

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        const q = url.searchParams.get("q") || undefined;
        const users = await listUsersDb(q);
        return corsJson({ success: true, users });
      },
    },
  },
});
