import React, { useState, useEffect, useCallback } from "react";
import { authService } from "@/lib/assistant/auth-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  Copy,
  Check,
  Plus,
  RefreshCw,
  XCircle,
  Clock,
  Shield,
  Users,
  UserPlus,
  UserCheck,
  Search,
} from "lucide-react";
import { toast } from "sonner";

interface UserRecord {
  id: string;
  role: "admin" | "user";
  status: string;
  createdAt: string;
  lastActiveAt?: string | null;
  conversationCount: number;
}

interface KeyRecord {
  id: string;
  key?: string;
  keyPrefix: string;
  status: "AVAILABLE" | "REDEEMED" | "EXPIRED" | "REVOKED";
  durationMs: number;
  role: "admin" | "user";
  assignedUserId?: string | null;
  userId?: string | null;
  purpose?: "NEW_USER" | "REPLACEMENT";
  createdAt: string;
  redeemedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  adminNote?: string | null;
  remainingMs?: number | null;
}

const DURATION_PRESETS = [
  { label: "15 minutes", ms: 15 * 60 * 1000 },
  { label: "30 minutes", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
  { label: "3 hours (Default)", ms: 3 * 60 * 60 * 1000 },
  { label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Permanent (No Expiry)", ms: 0 },
  { label: "Custom", ms: -1 },
];

function formatDuration(ms: number): string {
  if (ms <= 0) return "Permanent";
  if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  }
  const hours = Math.round(ms / 3600000);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function InvitationKeysSettingsSection() {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form state
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userSearchQuery, setUserSearchQuery] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "user">("user");
  const [selectedDurationMs, setSelectedDurationMs] = useState<number>(3 * 60 * 60 * 1000);
  const [customMinutes, setCustomMinutes] = useState<string>("45");
  const [isGenerating, setIsGenerating] = useState(false);
  const [newlyCreatedKeys, setNewlyCreatedKeys] = useState<
    Array<{
      id: string;
      key: string;
      keyPrefix: string;
      durationMs: number;
      role: "admin" | "user";
      assignedUserId?: string | null;
      purpose?: "NEW_USER" | "REPLACEMENT";
    }>
  >([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authService.fetchWithAuth("/api/admin/keys");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load invitation keys.");
      }
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async (search?: string) => {
    setIsLoadingUsers(true);
    try {
      const url = search ? `/api/admin/users?q=${encodeURIComponent(search)}` : "/api/admin/users";
      const res = await authService.fetchWithAuth(url);
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      /* ignore */
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    fetchUsers();
  }, [fetchKeys, fetchUsers]);

  const handleGenerateKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setErrorMessage(null);

    const effectiveDurationMs =
      selectedDurationMs === -1
        ? Math.max(1, parseInt(customMinutes, 10) || 30) * 60 * 1000
        : selectedDurationMs;

    const assignedUserId = targetMode === "existing" && selectedUserId ? selectedUserId : null;
    const purpose: "NEW_USER" | "REPLACEMENT" = assignedUserId ? "REPLACEMENT" : "NEW_USER";

    if (targetMode === "existing" && !assignedUserId) {
      setErrorMessage("Please select an existing user account for the replacement key.");
      setIsGenerating(false);
      return;
    }

    try {
      const res = await authService.fetchWithAuth("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 1,
          durationMs: effectiveDurationMs,
          role: selectedRole,
          assignedUserId,
          purpose,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate key.");
      }

      const data = await res.json();
      setNewlyCreatedKeys(data.keys || []);
      toast.success(
        assignedUserId
          ? `Generated replacement key for user ${assignedUserId}.`
          : `Generated new ${selectedRole.toUpperCase()} invitation key.`,
      );
      fetchKeys();
      fetchUsers();
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      const res = await authService.fetchWithAuth("/api/admin/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to revoke key.");
      }

      toast("Key revoked successfully.");
      fetchKeys();
    } catch (err) {
      toast.error((err as Error).message || "Failed to revoke key.");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    toast.success("Key copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2500);
  };

  return (
    <div className="flex flex-col gap-6 text-sm">
      {/* Header Section */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-4">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold text-foreground">Invitation Keys</h3>
      </div>

      {/* Error Message Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Key Generation Form */}
      <form onSubmit={handleGenerateKeys} className="rounded-2xl border border-border/80 bg-muted/40 p-4 flex flex-col gap-4">
        {/* Recipient Target: New User vs Replacement for Existing User */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Key Purpose & Recipient</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setTargetMode("new");
                setSelectedUserId("");
              }}
              className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${
                targetMode === "new"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium text-xs">
                <UserPlus className="h-3.5 w-3.5" />
                <span>New User</span>
              </div>
              <span className="text-[10px] opacity-80">Creates a new permanent account upon redemption</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetMode("existing");
                fetchUsers();
              }}
              className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${
                targetMode === "existing"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Replacement Key</span>
              </div>
              <span className="text-[10px] opacity-80">Extends access for an existing user account</span>
            </button>
          </div>
        </div>

        {/* Existing User Search & Dropdown (When Replacement Key is chosen) */}
        {targetMode === "existing" && (
          <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Select Existing User</span>
              </label>
              <span className="text-[10px] text-muted-foreground">
                {isLoadingUsers ? "Loading..." : `${users.length} registered user${users.length === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search user ID..."
                value={userSearchQuery}
                onChange={(e) => {
                  setUserSearchQuery(e.target.value);
                  fetchUsers(e.target.value);
                }}
                className="pl-8 h-8 text-xs rounded-lg"
              />
            </div>

            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-foreground"
              required={targetMode === "existing"}
            >
              <option value="">-- Select existing user account --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id} ({u.role}) • {u.conversationCount} chats • {new Date(u.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>

            {selectedUserId && (
              <div className="text-[11px] text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                User <strong>{selectedUserId}</strong> will retain all chat history, messages, attachments, and settings upon redemption.
              </div>
            )}
          </div>
        )}

        {/* Role Dropdown */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Role</span>
          </label>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as "user" | "admin")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          >
            <option value="user">User Key (Standard access)</option>
            <option value="admin">Admin Key (Full admin + generator)</option>
          </select>
        </div>

        {/* Duration Dropdown */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Access Duration</span>
          </label>
          <select
            value={selectedDurationMs}
            onChange={(e) => setSelectedDurationMs(parseInt(e.target.value, 10))}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          >
            {DURATION_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.ms}>
                {preset.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {selectedDurationMs === 0
              ? "Session does not expire."
              : "Countdown starts the moment the recipient successfully redeems this key."}
          </span>
        </div>

        {/* Custom Duration (if selected) */}
        {selectedDurationMs === -1 && (
          <div className="flex flex-col gap-1.5 animate-in fade-in">
            <label className="text-xs font-medium text-foreground">Custom Duration (Minutes)</label>
            <Input
              type="number"
              min="1"
              max="43200"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="e.g. 45"
              className="rounded-xl text-sm"
            />
          </div>
        )}

        <Button
          type="submit"
          disabled={isGenerating}
          className="w-full h-10 text-sm font-medium gap-2 shadow-xs"
        >
          {isGenerating ? (
            <span>Generating...</span>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              <span>
                {targetMode === "existing" && selectedUserId
                  ? `Generate Replacement Key for ${selectedUserId}`
                  : `Generate ${selectedRole === "admin" ? "Admin" : "User"} Key`}
              </span>
            </>
          )}
        </Button>
      </form>

      {/* Newly Created Keys Announcement */}
      {newlyCreatedKeys.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-col gap-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400">Newly Generated Key</span>
            <span className="text-[11px] text-emerald-400/80">Copy now; values are hashed on refresh</span>
          </div>

          <div className="flex flex-col gap-2">
            {newlyCreatedKeys.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl bg-background/80 border border-emerald-500/20 px-3 py-2 font-mono text-sm text-foreground"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold tracking-wider">{item.key}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 uppercase ${
                        item.role === "admin"
                          ? "bg-purple-500/10 text-purple-400 border-purple-500/30 font-semibold"
                          : "bg-muted/80 text-muted-foreground border-border"
                      }`}
                    >
                      {item.role}
                    </Badge>
                    {item.assignedUserId ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/30 font-sans"
                      >
                        Replacement for: {item.assignedUserId}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 bg-slate-500/10 text-slate-400 border-slate-500/30 font-sans"
                      >
                        New User
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-sans">
                    Valid for {formatDuration(item.durationMs)} once redeemed
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(item.key)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Copy Key"
                >
                  {copiedKey === item.key ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Keys Table / List */}
      <div className="flex flex-col gap-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            Issued Keys History ({keys.length})
          </span>
          <button
            type="button"
            onClick={() => {
              fetchKeys();
              fetchUsers();
            }}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md"
            title="Refresh keys list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
            No invitation keys generated yet. Use the form above to issue your first key.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-[360px] overflow-y-auto pr-1">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 p-3 text-xs"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-foreground tracking-wide">
                      {k.keyPrefix}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 uppercase ${
                        k.role === "admin"
                          ? "bg-purple-500/10 text-purple-400 border-purple-500/30 font-semibold"
                          : "bg-muted/80 text-muted-foreground border-border/70"
                      }`}
                    >
                      {k.role || "user"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 uppercase ${
                        k.status === "AVAILABLE"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : k.status === "REDEEMED"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            : k.status === "EXPIRED"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-destructive/10 text-destructive border-destructive/30"
                      }`}
                    >
                      {k.status}
                    </Badge>
                    {k.assignedUserId ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/30 font-sans"
                      >
                        Assigned: {k.assignedUserId}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 bg-slate-500/10 text-slate-400 border-slate-500/30 font-sans"
                      >
                        New User
                      </Badge>
                    )}
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {formatDuration(k.durationMs)}
                    </span>
                    {k.adminNote && (
                      <span className="text-[11px] text-muted-foreground/80 truncate max-w-[140px]" title={k.adminNote}>
                        • {k.adminNote}
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                    {k.redeemedAt && (
                      <span>Redeemed: {new Date(k.redeemedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                    {k.userId && (
                      <span className="font-mono text-foreground/80">User: {k.userId}</span>
                    )}
                    {k.expiresAt && (
                      <span>Expires: {new Date(k.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                    {typeof k.remainingMs === "number" && k.remainingMs > 0 && (
                      <span className="text-emerald-400 font-medium font-mono">
                        Remaining: {Math.round(k.remainingMs / 60000)}m
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {k.status === "AVAILABLE" || k.status === "REDEEMED" ? (
                    <button
                      type="button"
                      onClick={() => handleRevokeKey(k.id)}
                      className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      title="Revoke Key"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
