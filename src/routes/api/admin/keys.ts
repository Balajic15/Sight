import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdminAuth } from "@/server/auth";
import { createInvitationKeysDb, listInvitationKeysDb } from "@/server/db";

const CreateKeysSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  durationMs: z.number().int().min(0).max(86400000 * 365).default(10800000),
  adminNote: z.string().max(200).optional(),
  role: z.enum(["admin", "user"]).default("user"),
  assignedUserId: z.string().trim().min(1).max(128).optional().nullable(),
  purpose: z.enum(["NEW_USER", "REPLACEMENT"]).optional(),
});

export const Route = createFileRoute("/api/admin/keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const keys = await listInvitationKeysDb();
          return Response.json({ success: true, keys });
        } catch (err) {
          console.error("Failed to list keys:", err);
          return Response.json({ success: false, error: "Failed to list invitation keys." }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const body = await request.json().catch(() => ({}));
          const parsed = CreateKeysSchema.parse(body);

          const keys = await createInvitationKeysDb(
            parsed.count,
            parsed.adminNote,
            parsed.durationMs,
            parsed.role,
            parsed.assignedUserId,
            parsed.purpose,
          );
          return Response.json({ success: true, keys });
        } catch (err) {
          const message =
            err instanceof z.ZodError
              ? err.errors[0]?.message || "Invalid payload."
              : (err as Error)?.message || "Failed to generate invitation keys.";
          return Response.json({ success: false, error: message }, { status: 400 });
        }
      },
    },
  },
});
