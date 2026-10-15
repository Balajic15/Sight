import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdminAuth, corsJson, corsOptions } from "@/server/auth";
import { createInvitationKeysDb, listInvitationKeysDb } from "@/server/db";

const CreateKeysSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  durationMs: z.number().int().min(0).max(86400000 * 365).default(10800000),
  adminNote: z.string().max(200).optional(),
  role: z.enum(["admin", "user"]).default("user"),
  assignedUserId: z.string().trim().min(1).max(128).optional().nullable(),
  purpose: z.string().optional(),
});

export const Route = createFileRoute("/api/admin/keys")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;
        const keys = await listInvitationKeysDb();
        return corsJson({ success: true, keys });
      },
      POST: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;
        try {
          const body = await request.json();
          const parsed = CreateKeysSchema.parse(body);
          const keys = await createInvitationKeysDb(parsed);
          return corsJson({ success: true, keys });
        } catch (err: unknown) {
          return corsJson({ success: false, error: (err as Error).message }, { status: 400 });
        }
      },
    },
  },
});
