import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdminAuth } from "@/server/auth";
import { revokeInvitationKeyDb } from "@/server/db";

const RevokeSchema = z.object({
  keyId: z.string().min(1, "Key ID is required"),
});

export const Route = createFileRoute("/api/admin/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const body = await request.json();
          const parsed = RevokeSchema.parse(body);

          const success = await revokeInvitationKeyDb(parsed.keyId);
          if (!success) {
            return Response.json(
              { success: false, error: "Key not found or could not be revoked." },
              { status: 404 },
            );
          }

          return Response.json({ success: true, revokedKeyId: parsed.keyId });
        } catch (err) {
          const message =
            err instanceof z.ZodError
              ? err.errors[0]?.message || "Invalid payload."
              : "Failed to revoke invitation key.";
          return Response.json({ success: false, error: message }, { status: 400 });
        }
      },
    },
  },
});
