import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdminAuth, corsJson, corsOptions } from "@/server/auth";
import { revokeInvitationKeyDb } from "@/server/db";

const RevokeSchema = z.object({
  keyId: z.string().min(1, "Key ID is required"),
});

export const Route = createFileRoute("/api/admin/revoke")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      POST: async ({ request }) => {
        const auth = await requireAdminAuth(request);
        if (auth instanceof Response) return auth;
        try {
          const body = await request.json();
          const parsed = RevokeSchema.parse(body);
          const ok = await revokeInvitationKeyDb(parsed.keyId);
          return corsJson({ success: ok });
        } catch (err: unknown) {
          return corsJson({ success: false, error: (err as Error).message }, { status: 400 });
        }
      },
    },
  },
});
