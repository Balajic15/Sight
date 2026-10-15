import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { redeemInvitationKeyAtomic } from "@/server/db";
import { corsJson, corsOptions } from "@/server/auth";

const RedeemSchema = z.object({
  key: z.string().trim().min(4).max(128),
});

// Self-pruning sliding window rate limiter
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  record.count++;
  return record.count > 10; // Max 10 attempts per minute
}

export const Route = createFileRoute("/api/auth/redeem")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      POST: async ({ request }) => {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown-ip";

        if (isRateLimited(ip)) {
          return corsJson(
            { error: "Too many redemption attempts. Please wait 1 minute." },
            { status: 429 },
          );
        }

        let body: z.infer<typeof RedeemSchema>;
        try {
          body = RedeemSchema.parse(await request.json());
        } catch {
          return corsJson({ error: "Invalid invitation key format." }, { status: 400 });
        }

        try {
          const result = await redeemInvitationKeyAtomic(body.key);

          if (!result.success || !result.sessionToken) {
            return corsJson(
              { error: result.error || "Invalid or already redeemed key." },
              { status: 400 },
            );
          }

          return corsJson({
            success: true,
            token: result.sessionToken,
            role: result.isAdmin ? "admin" : "user",
            userId: result.userId,
            expiresAt: result.expiresAt,
          });
        } catch (error) {
          console.error("[Redeem] Database redemption failure:", error);
          return corsJson(
            { error: "Internal key redemption error." },
            { status: 500 },
          );
        }
      },
    },
  },
});
