export const DEFAULT_BACKEND_URL = "https://sight-beta.vercel.app";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (typeof cap?.isNativePlatform === "function") {
    return cap.isNativePlatform();
  }
  const proto = window.location?.protocol;
  return proto === "capacitor:" || proto === "file:";
}

const STORAGE_KEYS = {
  token: "sight_auth_token",
  role: "sight_auth_role",
  expiresAt: "sight_auth_expires",
} as const;

export type AuthRole = "admin" | "user";

export interface AuthState {
  status: "idle" | "authenticated" | "unauthenticated";
  token: string | null;
  isAdmin: boolean;
  role: AuthRole | null;
  expiresAt: number | null;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isAuthRole(value: string | null): value is AuthRole {
  return value === "admin" || value === "user";
}

export function resolveApiUrl(path: string): string {
  const input = path.trim();

  // Absolute HTTP(S) URLs are preserved.
  if (/^https?:\/\//i.test(input)) {
    return input;
  }

  // Reject other explicit URL schemes rather than treating them as paths.
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) {
    throw new Error("Only HTTP(S) API URLs are supported.");
  }

  const cleanPath = `/${input.replace(/^\/+/, "")}`;

  if (isNativePlatform()) {
    return `${DEFAULT_BACKEND_URL.replace(/\/+$/, "")}${cleanPath}`;
  }

  return cleanPath;
}

export class AuthService {
  private static instance: AuthService;

  private token: string | null = null;
  private role: AuthRole | null = null;
  private expiresAt: number | null = null;

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): AuthService {
    return (this.instance ??= new AuthService());
  }

  private loadFromStorage(): void {
    const storage = getStorage();
    if (!storage) return;

    this.token = storage.getItem(STORAGE_KEYS.token);

    const storedRole = storage.getItem(STORAGE_KEYS.role);
    this.role = isAuthRole(storedRole) ? storedRole : null;

    const storedExpiry = Number(storage.getItem(STORAGE_KEYS.expiresAt));
    this.expiresAt =
      Number.isFinite(storedExpiry) && storedExpiry > 0
        ? storedExpiry
        : null;

    // Discard malformed or incomplete stored sessions.
    if (this.token && !this.role) {
      this.clearSession();
    }
  }

  public isAuthenticated(): boolean {
    if (!this.token) return false;

    if (this.expiresAt !== null && Date.now() >= this.expiresAt) {
      this.clearSession();
      return false;
    }

    return true;
  }

  public getToken(): string | null {
    return this.isAuthenticated() ? this.token : null;
  }

  public getAuthState(): AuthState {
    const authenticated = this.isAuthenticated();

    return {
      status: authenticated ? "authenticated" : "unauthenticated",
      token: authenticated ? this.token : null,
      isAdmin: authenticated && this.role === "admin",
      role: authenticated ? this.role : null,
      expiresAt: authenticated ? this.expiresAt : null,
    };
  }

  public setSession(
    token: string,
    role: AuthRole,
    expiresAt: number | null,
  ): void {
    const cleanToken = token.trim();

    if (!cleanToken) {
      throw new Error("An authentication token is required.");
    }

    if (
      expiresAt !== null &&
      (!Number.isFinite(expiresAt) || expiresAt <= 0)
    ) {
      throw new Error("The session expiry must be a valid timestamp.");
    }

    this.token = cleanToken;
    this.role = role;
    this.expiresAt = expiresAt;

    const storage = getStorage();
    if (!storage) return;

    try {
      storage.setItem(STORAGE_KEYS.token, cleanToken);
      storage.setItem(STORAGE_KEYS.role, role);

      if (expiresAt === null) {
        storage.removeItem(STORAGE_KEYS.expiresAt);
      } else {
        storage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
      }
    } catch {
      // In-memory auth remains usable if storage is blocked or full.
    }
  }

  public clearSession(): void {
    this.token = null;
    this.role = null;
    this.expiresAt = null;

    const storage = getStorage();
    if (!storage) return;

    try {
      Object.values(STORAGE_KEYS).forEach((key) => {
        storage.removeItem(key);
      });
    } catch {
      // In-memory state is already cleared.
    }
  }

  public fetchWithAuth(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = this.getToken();

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return fetch(resolveApiUrl(url), {
      ...init,
      headers,
    });
  }

  public async validateSessionWithServer(): Promise<boolean> {
    if (!this.isAuthenticated()) return false;

    try {
      const response = await this.fetchWithAuth("/api/auth/validate");

      if (response.status === 401 || response.status === 403) {
        this.clearSession();
        return false;
      }

      if (!response.ok) {
        // A server error is not proof that the session is invalid.
        return this.isAuthenticated();
      }

      const data: unknown = await response.json();

      const valid =
        typeof data === "object" &&
        data !== null &&
        "valid" in data &&
        data.valid === true;

      if (!valid) {
        this.clearSession();
      }

      return valid;
    } catch {
      // A network error alone should not log out a locally valid session.
      return this.isAuthenticated();
    }
  }

  public getStoredToken(): string | null {
    return this.getToken();
  }

  public getUserId(): string | null {
    const storage = getStorage();
    return storage?.getItem("sight_auth_userId") || (this.token ? "usr_current" : null);
  }

  public async validateSession(): Promise<AuthSession | null> {
    const token = this.getToken();
    if (!token) return null;

    try {
      const res = await this.fetchWithAuth("/api/auth/validate");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          this.clearSession();
        }
        return null;
      }
      const data: any = await res.json();
      if (!data.valid) {
        this.clearSession();
        return null;
      }
      const sess: AuthSession = {
        userId: data.userId || "user",
        role: data.isAdmin ? "admin" : "user",
        isAdmin: Boolean(data.isAdmin),
        expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : this.expiresAt,
      };
      return sess;
    } catch {
      return this.isAuthenticated()
        ? {
            userId: this.getUserId() || "user",
            role: this.role || "user",
            isAdmin: this.role === "admin",
            expiresAt: this.expiresAt,
          }
        : null;
    }
  }

  public async redeemKey(key: string): Promise<{ success: boolean; session?: AuthSession; error?: string }> {
    try {
      const res = await fetch(resolveApiUrl("/api/auth/redeem"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data: any = await res.json();
      if (!res.ok || !data.success || !data.token) {
        return { success: false, error: data.error || "Invalid or expired invitation key." };
      }

      const role: AuthRole = data.role === "admin" ? "admin" : "user";
      const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : null;
      this.setSession(data.token, role, expiresAt);

      if (data.userId) {
        getStorage()?.setItem("sight_auth_userId", data.userId);
      }

      const session: AuthSession = {
        userId: data.userId || "user",
        role,
        isAdmin: role === "admin",
        expiresAt,
      };

      return { success: true, session };
    } catch (err) {
      return { success: false, error: (err as Error)?.message || "Failed to redeem key." };
    }
  }

  public async logout(): Promise<void> {
    try {
      await this.fetchWithAuth("/api/logout", { method: "POST" });
    } catch {}
    this.clearSession();
  }
}

export interface AuthSession {
  userId: string;
  role: string;
  isAdmin: boolean;
  expiresAt: number | null;
}

export const authService = AuthService.getInstance();
