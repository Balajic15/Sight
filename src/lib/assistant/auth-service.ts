export type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "expired";

export interface AuthState {
  status: AuthStatus;
  sessionToken: string | null;
  userId: string | null;
  expiresAt: number | null; // epoch ms (null for permanent admin)
  remainingMs: number | null; // null for permanent admin
  isAdmin: boolean;
  errorMessage: string | null;
}

const STORAGE_KEY = "echo.auth.session.v1";

// Lightweight secure obfuscation to avoid plain-text storage
function obfuscate(text: string): string {
  try {
    return btoa(
      encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16)),
      ),
    );
  } catch {
    return text;
  }
}

function deobfuscate(text: string): string {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(text), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    return text;
  }
}

export class AuthService {
  private static instance: AuthService;
  private state: AuthState = {
    status: "checking",
    sessionToken: null,
    userId: null,
    expiresAt: null,
    remainingMs: null,
    isAdmin: false,
    errorMessage: null,
  };

  private subscribers: Array<(state: AuthState) => void> = [];
  private countdownTimer: NodeJS.Timeout | null = null;
  private hardExpiryTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private isCleaningUp = false;

  private constructor() {
    this.setupLifecycleListeners();
    if (typeof window !== "undefined") {
      const stored = this.loadStoredCredentials();
      if (stored) {
        if (stored.isAdmin && stored.expiresAt === null) {
          this.state = {
            status: "authenticated",
            sessionToken: stored.sessionToken,
            userId: stored.userId,
            expiresAt: null,
            remainingMs: null,
            isAdmin: true,
            errorMessage: null,
          };
          this.startTimers();
        } else if (typeof stored.expiresAt === "number" && stored.expiresAt > Date.now()) {
          this.state = {
            status: "authenticated",
            sessionToken: stored.sessionToken,
            userId: stored.userId,
            expiresAt: stored.expiresAt,
            remainingMs: stored.expiresAt - Date.now(),
            isAdmin: false,
            errorMessage: null,
          };
          this.startTimers();
        } else if (typeof stored.expiresAt === "number" && stored.expiresAt <= Date.now()) {
          this.state = {
            status: "expired",
            sessionToken: null,
            userId: null,
            expiresAt: null,
            remainingMs: 0,
            isAdmin: false,
            errorMessage: "Your access has expired. Enter a new Invitation Key to continue.",
          };
        } else {
          this.state = {
            status: "unauthenticated",
            sessionToken: null,
            userId: null,
            expiresAt: null,
            remainingMs: null,
            isAdmin: false,
            errorMessage: null,
          };
        }
      } else {
        this.state = {
          status: "unauthenticated",
          sessionToken: null,
          userId: null,
          expiresAt: null,
          remainingMs: null,
          isAdmin: false,
          errorMessage: null,
        };
      }
    }
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public getState(): AuthState {
    return { ...this.state };
  }

  public getUserId(): string | null {
    return this.state.userId;
  }

  public subscribe(fn: (state: AuthState) => void): () => void {
    this.subscribers.push(fn);
    fn({ ...this.state });
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== fn);
    };
  }

  private notify() {
    const snapshot: AuthState = { ...this.state };
    for (const sub of this.subscribers) {
      try {
        sub(snapshot);
      } catch (err) {
        console.error("Auth subscriber error:", err);
      }
    }
  }

  public getSessionToken(): string | null {
    return this.state.sessionToken;
  }

  public isAuthenticated(): boolean {
    if (this.state.status !== "authenticated") return false;
    if (this.state.isAdmin && this.state.expiresAt === null) return true;
    return (this.state.remainingMs ?? 0) > 0;
  }

  public isAdmin(): boolean {
    return this.state.status === "authenticated" && this.state.isAdmin;
  }

  public getAuthHeaders(): Record<string, string> {
    if (this.state.sessionToken) {
      return { Authorization: `Bearer ${this.state.sessionToken}` };
    }
    return {};
  }

  public getRemainingFormatted(): string {
    if (this.state.isAdmin && this.state.expiresAt === null) {
      return "Permanent Admin";
    }
    const totalSecs = Math.max(0, Math.floor((this.state.remainingMs ?? 0) / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  // ============================================================================
  // Initialization & Validation
  // ============================================================================

  public async init(): Promise<void> {
    if (typeof window === "undefined") return;

    const stored = this.loadStoredCredentials();
    if (!stored || !stored.sessionToken) {
      this.state = {
        status: "unauthenticated",
        sessionToken: null,
        userId: null,
        expiresAt: null,
        remainingMs: null,
        isAdmin: false,
        errorMessage: null,
      };
      this.notify();
      return;
    }

    if (stored.isAdmin && stored.expiresAt === null) {
      this.state = {
        status: "authenticated",
        sessionToken: stored.sessionToken,
        userId: stored.userId || "admin_permanent",
        expiresAt: null,
        remainingMs: null,
        isAdmin: true,
        errorMessage: null,
      };
      this.startTimers();
      this.notify();
      await this.validateSessionWithServer(stored.sessionToken);
      return;
    }

    const now = Date.now();
    const remaining = (stored.expiresAt ?? 0) - now;

    if (remaining <= 0) {
      await this.handleExpiration(
        "Your access has expired. Enter a new Invitation Key to continue.",
      );
      return;
    }

    this.state = {
      status: "authenticated",
      sessionToken: stored.sessionToken,
      userId: stored.userId || null,
      expiresAt: stored.expiresAt,
      remainingMs: remaining,
      isAdmin: false,
      errorMessage: null,
    };
    this.startTimers();
    this.notify();

    // Authoritative server check
    await this.validateSessionWithServer(stored.sessionToken);
  }

  public async validateSessionWithServer(tokenToValidate?: string): Promise<boolean> {
    const token = tokenToValidate || this.state.sessionToken;
    if (!token) {
      await this.handleExpiration();
      return false;
    }

    try {
      const res = await fetch("/api/auth/validate", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason =
          data?.error || "Your access has expired. Enter a new Invitation Key to continue.";
        await this.handleExpiration(reason);
        return false;
      }

      const data = await res.json();
      if (!data.valid) {
        await this.handleExpiration(
          data?.error || "Your access has expired. Enter a new Invitation Key to continue.",
        );
        return false;
      }

      // Permanent Administrator Session
      if (data.isAdmin && !data.expiresAt) {
        this.state = {
          status: "authenticated",
          sessionToken: token,
          userId: data.userId || "admin_permanent",
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
          errorMessage: null,
        };
        this.saveStoredCredentials(token, data.userId || "admin_permanent", null, true);
        this.startTimers();
        this.notify();
        return true;
      }

      // Ordinary timed session
      if (!data.expiresAt) {
        await this.handleExpiration(
          "Your access has expired. Enter a new Invitation Key to continue.",
        );
        return false;
      }

      const expiresEpoch = new Date(data.expiresAt).getTime();
      const remainingMs = Math.max(0, expiresEpoch - Date.now());

      if (remainingMs <= 0) {
        await this.handleExpiration(
          "Your access has expired. Enter a new Invitation Key to continue.",
        );
        return false;
      }

      this.state = {
        status: "authenticated",
        sessionToken: token,
        userId: data.userId || this.state.userId,
        expiresAt: expiresEpoch,
        remainingMs,
        isAdmin: false,
        errorMessage: null,
      };
      this.saveStoredCredentials(token, data.userId || this.state.userId, expiresEpoch, false);
      this.startTimers();
      this.notify();
      return true;
    } catch {
      // In offline scenario, fail-safe against local expiresAt
      if (this.state.expiresAt && Date.now() >= this.state.expiresAt) {
        await this.handleExpiration(
          "Your access has expired. Enter a new Invitation Key to continue.",
        );
        return false;
      }
      if (this.state.expiresAt && Date.now() < this.state.expiresAt) {
        this.state.status = "authenticated";
        this.startTimers();
        this.notify();
      }
      return this.isAuthenticated();
    }
  }

  // ============================================================================
  // Key Redemption
  // ============================================================================

  public async redeemKey(rawKey: string): Promise<{ success: boolean; error?: string }> {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      return { success: false, error: "Please enter an invitation key." };
    }

    try {
      const res = await fetch("/api/auth/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.error || "Invalid or expired invitation key.",
        };
      }

      // Master administrator key redemption
      if (data.isAdmin && !data.expiresAt) {
        this.state = {
          status: "authenticated",
          sessionToken: data.sessionToken,
          userId: data.userId || "admin_permanent",
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
          errorMessage: null,
        };
        this.saveStoredCredentials(data.sessionToken, data.userId || "admin_permanent", null, true);
        this.startTimers();
        this.notify();
        return { success: true };
      }

      // Ordinary key redemption with configured duration
      const expiresEpoch = new Date(data.expiresAt).getTime();
      const remainingMs = Math.max(0, expiresEpoch - Date.now());

      this.state = {
        status: "authenticated",
        sessionToken: data.sessionToken,
        userId: data.userId || null,
        expiresAt: expiresEpoch,
        remainingMs,
        isAdmin: false,
        errorMessage: null,
      };

      this.saveStoredCredentials(data.sessionToken, data.userId || null, expiresEpoch, false);
      this.startTimers();
      this.notify();

      return { success: true };
    } catch (err) {
      console.error("Redeem network error:", err);
      return {
        success: false,
        error: "Network error communicating with the server. Please check your connection.",
      };
    }
  }

  // ============================================================================
  // Logout & Resource Teardown
  // ============================================================================

  public async logout(customMessage?: string): Promise<void> {
    const currentToken = this.state.sessionToken;
    if (currentToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }

    await this.handleExpiration(customMessage || null);
  }

  public async handleExpiration(message?: string | null): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      this.stopTimers();
      this.clearStoredCredentials();

      // Stop all active realtime resources (voice, camera, screen share, audio playback)
      try {
        const { realtimeSessionService } = await import("./session-manager");
        await realtimeSessionService.stop();
      } catch (err) {
        console.error("Error stopping session manager on auth expiration:", err);
      }

      // Stop audio recorder dictation if active
      try {
        const { audioRecorder } = await import("./audio-recorder");
        audioRecorder.release();
      } catch {
        /* ignore */
      }

      this.state = {
        status: message ? "expired" : "unauthenticated",
        sessionToken: null,
        userId: null,
        expiresAt: null,
        remainingMs: null,
        isAdmin: false,
        errorMessage: message || null,
      };
      this.notify();
    } finally {
      this.isCleaningUp = false;
    }
  }

  // ============================================================================
  // Authenticated Fetch Wrapper
  // ============================================================================

  public async fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    // Check local expiry before dispatching (if not permanent admin)
    if (!this.state.isAdmin && this.state.expiresAt && Date.now() >= this.state.expiresAt) {
      await this.handleExpiration(
        "Your access has expired. Enter a new Invitation Key to continue.",
      );
      throw new Error("Session expired");
    }

    const headers = new Headers(init.headers || {});
    if (this.state.sessionToken) {
      headers.set("Authorization", `Bearer ${this.state.sessionToken}`);
    }

    const response = await fetch(input, { ...init, headers });

    // Catch 401 session expired responses from server
    if (response.status === 401) {
      const clone = response.clone();
      try {
        const data = await clone.json();
        if (data?.code === "SESSION_EXPIRED" || data?.error?.includes("expired")) {
          await this.handleExpiration(
            "Your access has expired. Enter a new Invitation Key to continue.",
          );
        }
      } catch {
        /* ignore parse errors */
      }
    }

    return response;
  }

  // ============================================================================
  // Timers & Storage Helpers
  // ============================================================================

  private startTimers() {
    this.stopTimers();

    // 1. Live Countdown timer (only for expiring sessions)
    if (this.state.expiresAt) {
      this.countdownTimer = setInterval(() => {
        if (!this.state.expiresAt) return;
        const remaining = Math.max(0, this.state.expiresAt - Date.now());
        this.state.remainingMs = remaining;

        if (remaining <= 0) {
          this.handleExpiration(
            "Your access has expired. Enter a new Invitation Key to continue.",
          );
        } else {
          this.notify();
        }
      }, 1000);

      // 2. Hard timeout at exact millisecond of expiration
      const delay = Math.max(0, this.state.expiresAt - Date.now());
      this.hardExpiryTimer = setTimeout(() => {
        this.handleExpiration(
          "Your access has expired. Enter a new Invitation Key to continue.",
        );
      }, delay);
    }

    // 3. Periodic server sync check (every 45s)
    this.syncTimer = setInterval(() => {
      if (this.state.sessionToken) {
        this.validateSessionWithServer();
      }
    }, 45000);
  }

  private stopTimers() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.hardExpiryTimer) {
      clearTimeout(this.hardExpiryTimer);
      this.hardExpiryTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private setupLifecycleListeners() {
    if (typeof document === "undefined") return;

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.state.sessionToken) {
        // App returned to foreground: immediately check expiration if expiring session
        if (!this.state.isAdmin && this.state.expiresAt && Date.now() >= this.state.expiresAt) {
          this.handleExpiration(
            "Your access has expired. Enter a new Invitation Key to continue.",
          );
        } else {
          this.validateSessionWithServer();
        }
      }
    });

    window.addEventListener("focus", () => {
      if (this.state.sessionToken) {
        if (!this.state.isAdmin && this.state.expiresAt && Date.now() >= this.state.expiresAt) {
          this.handleExpiration(
            "Your access has expired. Enter a new Invitation Key to continue.",
          );
        }
      }
    });
  }

  private loadStoredCredentials(): {
    sessionToken: string;
    userId: string | null;
    expiresAt: number | null;
    isAdmin: boolean;
  } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const json = deobfuscate(raw);
      const data = JSON.parse(json);
      if (typeof data.sessionToken === "string") {
        return {
          sessionToken: data.sessionToken,
          userId: typeof data.userId === "string" ? data.userId : null,
          expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
          isAdmin: Boolean(data.isAdmin),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private saveStoredCredentials(
    sessionToken: string,
    userId: string | null,
    expiresAt: number | null,
    isAdmin = false,
  ): void {
    try {
      const json = JSON.stringify({ sessionToken, userId, expiresAt, isAdmin });
      localStorage.setItem(STORAGE_KEY, obfuscate(json));
    } catch {
      /* ignore quota errors */
    }
  }

  private clearStoredCredentials(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const authService = AuthService.getInstance();
