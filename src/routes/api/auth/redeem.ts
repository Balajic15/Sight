import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { redeemInvitationKeyAtomic, validateSessionTokenDb } from "@/server/db";
import { extractBearerToken } from "@/server/auth";

const RedeemSchema = z.object({
  key: z.string().min(1, "Invitation key is required"),
});

const failedAttemptsMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = failedAttemptsMap.get(ip);
  if (!record || now > record.resetAt) {
    return true;
  }
  return record.count < 10;
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = failedAttemptsMap.get(ip);
  if (!record || now > record.resetAt) {
    failedAttemptsMap.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    record.count++;
  }
}

export const Route = createFileRoute("/api/auth/redeem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("cf-connecting-ip") ||
          "client";

        if (!checkRateLimit(ip)) {
          return Response.json(
            {
              success: false,
              error: "Too many failed redemption attempts. Please wait 5 minutes before trying again.",
            },
            { status: 429 },
          );
        }

        // Active Session Guard: do not silently replace identity if an active session exists
        const existingToken = extractBearerToken(request);
        if (existingToken) {
          const existingSession = await validateSessionTokenDb(existingToken);
          if (existingSession.valid && existingSession.session) {
            return Response.json(
              {
                success: false,
                code: "ACTIVE_SESSION_EXISTS",
                error:
                  "An active user session already exists. Please log out first before redeeming a new invitation key.",
              },
              { status: 409 },
            );
          }
        }

        try {
          const body = await request.json();
          const parsed = RedeemSchema.parse(body);

          const result = await redeemInvitationKeyAtomic(parsed.key);
          if (!result.success) {
            recordFailedAttempt(ip);
            return Response.json(
              {
                success: false,
                error: result.error || "Failed to redeem invitation key.",
              },
              { status: 400 },
            );
          }

          failedAttemptsMap.delete(ip);

          return Response.json({
            success: true,
            sessionToken: result.sessionToken,
            userId: result.userId,
            expiresAt: result.expiresAt || null,
            remainingMs: result.remainingMs ?? null,
            isAdmin: Boolean(result.isAdmin),
          });
        } catch (err) {
          recordFailedAttempt(ip);
          const message =
            err instanceof z.ZodError
              ? err.errors[0]?.message || "Invalid request body."
              : "Failed to redeem invitation key.";
          return Response.json({ success: false, error: message }, { status: 400 });
        }
      },
    },
  },
});
