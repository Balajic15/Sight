import { validateSessionTokenDb, getMasterAdminKey } from "./db";
import crypto from "node:crypto";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-session-token, x-admin-secret",
  "Access-Control-Max-Age": "86400",
};

export function corsJson(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return Response.json(data, { ...init, headers });
}

export function corsOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getAdminSecret(): string | null {
  const secret = process.env["ADMIN_SECRET"]?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function extractBearerToken(request: Request): string | null {
  const authHeader =
    request.headers.get("authorization") ||
    request.headers.get("Authorization");
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const customHeader = request.headers.get("x-session-token");
  if (customHeader?.trim()) {
    return customHeader.trim();
  }

  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get("token");
    if (queryToken?.trim()) return queryToken.trim();
  } catch {
    // Ignore invalid request URL parsing
  }

  return null;
}

export interface AuthenticatedSession {
  id: string;
  invitationKeyId: string;
  userId: string;
  expiresAt: string | null;
  remainingMs: number | null;
  isAdmin: boolean;
}

export async function requireSessionAuth(
  request: Request,
): Promise<{ session: AuthenticatedSession } | Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return corsJson(
      {
        error: "Authentication required. Please provide a valid session token.",
        code: "UNAUTHENTICATED",
      },
      { status: 401 },
    );
  }

  try {
    const validation = await validateSessionTokenDb(token);
    if (!validation.valid || !validation.session) {
      const isExpired = validation.reason === "expired";
      return corsJson(
        {
          error: isExpired
            ? "Your session has expired. Please log in or redeem a new key."
            : "Invalid or revoked session.",
          code: isExpired ? "SESSION_EXPIRED" : "INVALID_SESSION",
          expiresAt: validation.session?.expiresAt || null,
        },
        { status: 401 },
      );
    }

    return { session: validation.session as AuthenticatedSession };
  } catch (error) {
    console.error("[Auth] Session validation database error:", error);
    return corsJson(
      { error: "Authentication service temporarily unavailable.", code: "AUTH_ERROR" },
      { status: 503 },
    );
  }
}

export async function requireAdminAuth(
  request: Request,
): Promise<boolean | Response> {
  const masterKey = getMasterAdminKey();
  const configuredSecret = getAdminSecret();
  const adminSecretHeader = request.headers.get("x-admin-secret")?.trim();
  const token = extractBearerToken(request);

  if (adminSecretHeader) {
    if (
      (masterKey && safeCompare(adminSecretHeader, masterKey)) ||
      (configuredSecret && safeCompare(adminSecretHeader, configuredSecret))
    ) {
      return true;
    }
  }

  if (token) {
    if (
      (masterKey && safeCompare(token, masterKey)) ||
      (configuredSecret && safeCompare(token, configuredSecret))
    ) {
      return true;
    }

    const validation = await validateSessionTokenDb(token);
    if (validation.valid && validation.session?.isAdmin) {
      return true;
    }
  }

  return corsJson(
    {
      error: "Unauthorized. Administrator credentials required.",
      code: "UNAUTHORIZED_ADMIN",
    },
    { status: 403 },
  );
}
