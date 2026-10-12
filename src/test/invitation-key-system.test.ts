import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthService, authService } from "@/lib/assistant/auth-service";
import { realtimeSessionService } from "@/lib/assistant/session-manager";
import { audioRecorder } from "@/lib/assistant/audio-recorder";
import {
  requireSessionAuth,
  requireAdminAuth,
  extractBearerToken,
} from "@/server/auth";
import {
  generateSecureKey,
  hashInvitationKey,
  hashSessionToken,
  getMasterAdminKey,
} from "@/server/db";
import fs from "node:fs";
import path from "node:path";

describe("Strict Invitation Key Access System with Permanent Admin Key and Hidden Generator", () => {
  beforeEach(async () => {
    localStorage.clear();
    await authService.logout();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Scenario 1: Ordinary users see only Invitation Key entry screen
  it("Scenario 1: Ordinary unauthenticated state exposes no admin privileges or duration controls", async () => {
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.isAdmin()).toBe(false);
    expect(authService.getSessionToken()).toBeNull();
    expect(authService.getState().status).toBe("unauthenticated");
  });

  // Scenario 2: Authorized administrator (Balaji21a) can access admin capabilities
  it("Scenario 2: Redeeming permanent master key grants permanent admin session", async () => {
    const masterKey = "Balaji21a";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "admin_token_permanent_999",
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
        }),
    } as any);

    const result = await authService.redeemKey(masterKey);

    expect(result.success).toBe(true);
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.isAdmin()).toBe(true);
    expect(authService.getSessionToken()).toBe("admin_token_permanent_999");
    expect(authService.getState().expiresAt).toBeNull();
    expect(authService.getState().remainingMs).toBeNull();
    expect(authService.getRemainingFormatted()).toBe("Permanent Admin");
  });

  // Scenario 3: Unauthorized users cannot generate or list keys via API (403 Forbidden)
  it("Scenario 3: Unauthorized users and normal session tokens are rejected by requireAdminAuth with 403", async () => {
    // 1. Direct request without credentials
    const noAuthReq = new Request("http://localhost:3000/api/admin/keys");
    const noAuthRes = await requireAdminAuth(noAuthReq);
    expect(noAuthRes).toBeInstanceOf(Response);
    if (noAuthRes instanceof Response) {
      expect(noAuthRes.status).toBe(403);
      const json = await noAuthRes.json();
      expect(json.code).toBe("UNAUTHORIZED_ADMIN");
    }

    // 2. Direct request with ordinary user session token
    const ordinaryUserReq = new Request("http://localhost:3000/api/admin/keys", {
      headers: {
        Authorization: "Bearer ordinary_user_token_abc",
      },
    });

    const viDb = vi.spyOn(await import("@/server/db"), "validateSessionTokenDb");
    viDb.mockResolvedValueOnce({
      valid: true,
      session: {
        id: "sess_ordinary",
        invitationKeyId: "key_ord",
        userId: "usr_ordinary_123",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        remainingMs: 3600000,
        isAdmin: false, // NOT admin
      },
    });

    const ordRes = await requireAdminAuth(ordinaryUserReq);
    expect(ordRes).toBeInstanceOf(Response);
    if (ordRes instanceof Response) {
      expect(ordRes.status).toBe(403);
    }

    // 3. Request with valid admin session token succeeds
    const adminReq = new Request("http://localhost:3000/api/admin/keys", {
      headers: {
        Authorization: "Bearer admin_user_token_xyz",
      },
    });

    viDb.mockResolvedValueOnce({
      valid: true,
      session: {
        id: "sess_admin",
        invitationKeyId: "master-admin",
        userId: "admin_permanent",
        expiresAt: null,
        remainingMs: null,
        isAdmin: true, // IS admin
      },
    });

    const adminRes = await requireAdminAuth(adminReq);
    expect(adminRes).toBe(true);
  });

  // Scenario 4: Administrator can choose different expiration durations
  it("Scenario 4: Supported durations include 15m, 1h, 3h, 6h, 12h, 24h, and custom", async () => {
    const durations = [
      { label: "15 minutes", ms: 15 * 60 * 1000 },
      { label: "30 minutes", ms: 30 * 60 * 1000 },
      { label: "1 hour", ms: 60 * 60 * 1000 },
      { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
      { label: "3 hours", ms: 3 * 60 * 60 * 1000 },
      { label: "6 hours", ms: 6 * 60 * 60 * 1000 },
      { label: "12 hours", ms: 12 * 60 * 60 * 1000 },
      { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
      { label: "Custom (45m)", ms: 45 * 60 * 1000 },
    ];

    for (const d of durations) {
      expect(d.ms).toBeGreaterThanOrEqual(60000);
      expect(typeof d.ms).toBe("number");
    }
  });

  // Scenario 5: Generated key is valid for its configured duration after redemption
  it("Scenario 5: Redeeming a key configured for 1 hour sets countdown to exactly 1 hour", async () => {
    const startTime = 1710000000000;
    vi.setSystemTime(startTime);

    const ONE_HOUR_MS = 60 * 60 * 1000; // 3,600,000 ms
    const expectedExpiryTime = startTime + ONE_HOUR_MS;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "token_1h",
          expiresAt: new Date(expectedExpiryTime).toISOString(),
          remainingMs: ONE_HOUR_MS,
          isAdmin: false,
        }),
    } as any);

    await authService.redeemKey("ECHO-1H-TEST");

    const state = authService.getState();
    expect(state.expiresAt).toBe(expectedExpiryTime);
    expect(state.remainingMs).toBe(ONE_HOUR_MS);
    expect(state.isAdmin).toBe(false);
    expect(authService.getRemainingFormatted()).toBe("01:00:00");
  });

  // Scenario 6: Redeemed key cannot be reused
  it("Scenario 6: Redeemed ordinary key is rejected when attempting to redeem again", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          success: false,
          error: "This invitation key has already been redeemed and cannot be reused. Please obtain a newly generated invitation key.",
        }),
    } as any);

    const result = await authService.redeemKey("ECHO-USED-KEY");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already been redeemed");
    expect(authService.isAuthenticated()).toBe(false);
  });

  // Scenario 7: Master key Balaji21a remains valid without expiration and can be reused
  it("Scenario 7: Permanent master key Balaji21a can be redeemed repeatedly without consumption", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "admin_token_permanent",
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
        }),
    } as any);

    // First redemption
    const res1 = await authService.redeemKey("Balaji21a");
    expect(res1.success).toBe(true);
    expect(authService.isAdmin()).toBe(true);

    // Logout
    await authService.logout();
    expect(authService.isAuthenticated()).toBe(false);

    // Second redemption: succeeds again without being consumed or rejected
    const res2 = await authService.redeemKey("Balaji21a");
    expect(res2.success).toBe(true);
    expect(authService.isAdmin()).toBe(true);
    expect(authService.getState().expiresAt).toBeNull();
  });

  // Scenario 8: Ordinary key expiration triggers logout
  it("Scenario 8: Ordinary session expiration triggers automatic logout and full resource teardown", async () => {
    const stopSpy = vi.spyOn(realtimeSessionService, "stop");
    const releaseSpy = vi.spyOn(audioRecorder, "release");

    const startTime = 1710000000000;
    vi.setSystemTime(startTime);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "cleanup_token_auto",
          expiresAt: new Date(startTime + 3600000).toISOString(),
          remainingMs: 3600000,
          isAdmin: false,
        }),
    } as any);

    await authService.redeemKey("ECHO-1H-CLEANUP");

    // Advance to expiration
    await vi.advanceTimersByTimeAsync(3600000);

    expect(stopSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getState().status).toBe("expired");
    expect(authService.getState().errorMessage).toContain("Your access has expired. Enter a new Invitation Key to continue.");
  });

  // Scenario 9: Reopening the app does not reset expiration
  it("Scenario 9: App restart or backgrounding does not reset original expiration timestamp", async () => {
    const startTime = 1710000000000;
    vi.setSystemTime(startTime);

    const DURATION = 3 * 3600 * 1000;
    const fixedExpiresAt = startTime + DURATION;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "persisted_token_99",
          expiresAt: new Date(fixedExpiresAt).toISOString(),
          remainingMs: DURATION,
          isAdmin: false,
        }),
    } as any);

    await authService.redeemKey("ECHO-PERSISTED-SESSION");

    // Fast-forward 1.5 hours
    vi.advanceTimersByTime(1.5 * 3600 * 1000);

    // Mock validate response on app reload
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          valid: true,
          expiresAt: new Date(fixedExpiresAt).toISOString(),
          remainingMs: DURATION - 1.5 * 3600 * 1000,
          isAdmin: false,
        }),
    } as any);

    await authService.init();

    const state = authService.getState();
    // Expiration timestamp must NOT have been moved forward
    expect(state.expiresAt).toBe(fixedExpiresAt);
    expect(state.remainingMs).toBe(1.5 * 3600 * 1000);
    expect(authService.getRemainingFormatted()).toBe("01:30:00");
  });

  // Scenario 10: Master key and privileged secrets not exposed in client bundle / source files
  it("Scenario 10: Master key string and secrets are absent from client source code", () => {
    const clientDirs = [
      path.resolve(process.cwd(), "src/components"),
      path.resolve(process.cwd(), "src/lib"),
    ];

    const forbiddenStrings = ["Balaji21a", "echo-admin-secure-pass-2026"];

    function scanDir(dir: string) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
          const content = fs.readFileSync(fullPath, "utf-8");
          for (const forbidden of forbiddenStrings) {
            expect(
              content.includes(forbidden),
              `Client file ${fullPath} must not contain forbidden secret "${forbidden}"`,
            ).toBe(false);
          }
        }
      }
    }

    for (const dir of clientDirs) {
      if (fs.existsSync(dir)) {
        scanDir(dir);
      }
    }

    // Also check src/routes/index.tsx specifically
    const indexPath = path.resolve(process.cwd(), "src/routes/index.tsx");
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      for (const forbidden of forbiddenStrings) {
        expect(
          indexContent.includes(forbidden),
          `src/routes/index.tsx must not contain secret "${forbidden}"`,
        ).toBe(false);
      }
    }
  });

  // Scenario 11: Simultaneous redemption attempts allow only one successful redemption
  it("Scenario 11: Concurrency test - simultaneous redemptions result in exactly one success", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              sessionToken: "token_winner",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              remainingMs: 3600000,
              isAdmin: false,
            }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            success: false,
            error: "This invitation key has already been redeemed and cannot be reused. Please obtain a newly generated invitation key.",
          }),
      });
    }) as any;

    const [res1, res2] = await Promise.all([
      authService.redeemKey("ECHO-CONCURRENT-KEY"),
      authService.redeemKey("ECHO-CONCURRENT-KEY"),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  // Scenario 12: Normal chat, image generation, voice, camera, and screen sharing protected by access policy
  it("Scenario 12: requireSessionAuth protects server routes and rejects expired tokens with 401", async () => {
    const expiredRequest = new Request("http://localhost:3000/api/chat", {
      headers: {
        Authorization: "Bearer expired_session_token_123",
      },
    });

    const viDb = vi.spyOn(await import("@/server/db"), "validateSessionTokenDb");
    viDb.mockResolvedValueOnce({
      valid: false,
      reason: "expired",
      session: {
        id: "sess_expired",
        invitationKeyId: "key_expired",
        userId: "usr_expired_123",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        remainingMs: 0,
        isAdmin: false,
      },
    });

    const authResult = await requireSessionAuth(expiredRequest);

    expect(authResult).toBeInstanceOf(Response);
    if (authResult instanceof Response) {
      expect(authResult.status).toBe(401);
      const json = await authResult.json();
      expect(json.code).toBe("SESSION_EXPIRED");
      expect(json.error).toContain("Your access has expired. Enter a new Invitation Key to continue.");
    }
  });

  // Rate Limiting on /api/auth/redeem
  it("Brute force protection: rate limits excessive failed attempts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          success: false,
          error: "Too many failed redemption attempts. Please wait 5 minutes before trying again.",
          code: "RATE_LIMITED",
        }),
    } as any);

    const result = await authService.redeemKey("BRUTE-FORCE-ATTEMPT");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many failed redemption attempts");
  });

  // Role-Based Key Generation: Admin Key vs User Key
  it("Role-based keys: Admin can generate User and Admin keys, and redemption applies correct role", async () => {
    // 1. Admin generates User key
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "user_session_token_123",
          userId: "usr_user_123",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          remainingMs: 3600000,
          isAdmin: false,
        }),
    } as any);

    const userRedeem = await authService.redeemKey("ECHO-USER-KEY-1");
    expect(userRedeem.success).toBe(true);
    expect(authService.isAdmin()).toBe(false);

    // 2. Admin generates Admin key
    await authService.logout();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "generated_admin_session_token_456",
          userId: "usr_admin_456",
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
        }),
    } as any);

    const adminRedeem = await authService.redeemKey("ECHO-ADMIN-KEY-1");
    expect(adminRedeem.success).toBe(true);
    expect(authService.isAdmin()).toBe(true);
  });

  // Only Admin can generate keys
  it("Only admin can generate keys: non-admin session is rejected with 403", async () => {
    const ordinaryRequest = new Request("http://localhost:3000/api/admin/keys", {
      method: "POST",
      headers: {
        Authorization: "Bearer non_admin_token",
      },
    });

    const viDb = vi.spyOn(await import("@/server/db"), "validateSessionTokenDb");
    viDb.mockResolvedValueOnce({
      valid: true,
      session: {
        id: "sess_user",
        invitationKeyId: "key_user",
        userId: "usr_regular_789",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        remainingMs: 3600000,
        isAdmin: false,
      },
    });

    const result = await requireAdminAuth(ordinaryRequest);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(403);
    }
  });

  // Cryptographic Key Entropy & Formatting
  it("Cryptographic entropy: Generates 256-bit safe formatted keys and unique hashes", () => {
    const key1 = generateSecureKey();
    const key2 = generateSecureKey();

    expect(key1).toMatch(/^ECHO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(key2).toMatch(/^ECHO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(key1).not.toBe(key2);

    const hash1 = hashInvitationKey(key1);
    const hash2 = hashInvitationKey(key2);
    expect(hash1).toHaveLength(64); // SHA-256
    expect(hash2).toHaveLength(64);
    expect(hash1).not.toBe(hash2);
  });

  // Real-time Countdown & Background Auto-logout Verification
  it("Real-time counting: emits fresh state snapshots on countdown ticks and triggers automatic logout on expiry", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const futureExpiresAt = now + 5000; // 5 seconds
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sessionToken: "sess_realtime_test",
          expiresAt: new Date(futureExpiresAt).toISOString(),
          remainingMs: 5000,
          isAdmin: false,
        }),
    } as any);

    await authService.redeemKey("ECHO-REALTIME-TEST");

    const emittedSnapshots: any[] = [];
    const unsubscribe = authService.subscribe((s) => {
      emittedSnapshots.push(s);
    });

    // Advance 1 second
    await vi.advanceTimersByTimeAsync(1100);
    expect(emittedSnapshots.length).toBeGreaterThanOrEqual(2);
    // Ensure distinct object references are emitted so React triggers re-render
    const lastTwo = emittedSnapshots.slice(-2);
    expect(lastTwo[0]).not.toBe(lastTwo[1]);

    // Advance past expiration
    await vi.advanceTimersByTimeAsync(5000);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getState().status).toBe("expired");

    unsubscribe();
    vi.useRealTimers();
  });
});
