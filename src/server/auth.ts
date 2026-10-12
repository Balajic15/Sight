import { validateSessionTokenDb, getMasterAdminKey } from "./db";
import fs from "node:fs";
import path from "node:path";

function getAdminSecret(): string {
  if (process.env["ADMIN_SECRET"]) return process.env["ADMIN_SECRET"];
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*ADMIN_SECRET\s*=\s*(.*?)\s*$/);
        if (match && match[1]) return match[1].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch {
    /* ignore read errors */
  }
  return "echo-admin-secure-pass-2026";
}

export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0]?.toLowerCase() === "bearer") {
      return parts[1]!.trim();
    }
  }

  // Fallback to custom session header
  const customHeader = request.headers.get("x-session-token");
  if (customHeader) {
    return customHeader.trim();
  }

  // Fallback to query param
  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get("token");
    if (queryToken) return queryToken.trim();
  } catch {
    /* ignore url parse error */
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
    return Response.json(
      {
        error: "Authentication required. Please enter a valid invitation key.",
        code: "UNAUTHENTICATED",
      },
      { status: 401 },
    );
  }

  const validation = await validateSessionTokenDb(token);
  if (!validation.valid || !validation.session) {
    const isExpired = validation.reason === "expired";
    return Response.json(
      {
        error: isExpired
          ? "Your access has expired. Enter a new Invitation Key to continue."
          : "Invalid or revoked access session. Please enter a valid invitation key.",
        code: isExpired ? "SESSION_EXPIRED" : "INVALID_SESSION",
        expiresAt: validation.session?.expiresAt || null,
      },
      { status: 401 },
    );
  }

  return { session: validation.session };
}

export async function requireAdminAuth(request: Request): Promise<boolean | Response> {
  const masterKey = getMasterAdminKey();
  const configuredSecret = getAdminSecret();
  const adminSecretHeader = request.headers.get("x-admin-secret");
  const token = extractBearerToken(request);

  const providedSecret = adminSecretHeader?.trim();
  if (providedSecret && (providedSecret === masterKey || providedSecret === configuredSecret)) {
    return true;
  }

  if (token) {
    if (token === masterKey || token === configuredSecret) {
      return true;
    }
    const validation = await validateSessionTokenDb(token);
    if (validation.valid && validation.session?.isAdmin) {
      return true;
    }
  }

  return Response.json(
    {
      error: "Unauthorized. Administrator authorization required.",
      code: "UNAUTHORIZED_ADMIN",
    },
    { status: 403 },
  );
}
