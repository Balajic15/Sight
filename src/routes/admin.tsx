import React, { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authService, type AuthSession } from "@/lib/auth-service";

export const Route = createFileRoute("/admin")({
  component: AdminDashboardComponent,
});

interface InvitationKey {
  id: string;
  key: string;
  role: "admin" | "user";
  durationMs: number;
  adminNote?: string;
  isRedeemed: boolean;
  revoked: boolean;
  createdAt: number;
}

interface UserSummary {
  userId: string;
  role: string;
  sessionCount: number;
  lastActive: number;
}

function AdminDashboardComponent() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [keys, setKeys] = useState<InvitationKey[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State for Key Creation
  const [count, setCount] = useState(1);
  const [durationHours, setDurationHours] = useState(3);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [adminNote, setAdminNote] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const init = async () => {
      const current = await authService.validateSession();
      if (!current || !current.isAdmin) {
        navigate({ to: "/" });
        return;
      }
      setSession(current);
      await loadAdminData();
    };
    init();
  }, [navigate]);

  const loadAdminData = async () => {
    setLoading(true);
    const token = authService.getStoredToken();
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [keysRes, usersRes] = await Promise.all([
        fetch("/api/admin/keys", { headers }),
        fetch("/api/admin/users", { headers }),
      ]);

      if (keysRes.ok) {
        const data = await keysRes.json();
        setKeys(data.keys || []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    const token = authService.getStoredToken();

    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          count,
          durationMs: durationHours * 3600 * 1000,
          role,
          adminNote: adminNote.trim() || undefined,
        }),
      });

      if (res.ok) {
        setAdminNote("");
        await loadAdminData();
      }
    } catch (err) {
      console.error("Failed to create keys:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm("Revoke this invitation key immediately?")) return;
    const token = authService.getStoredToken();

    try {
      const res = await fetch("/api/admin/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ keyId }),
      });
      if (res.ok) {
        await loadAdminData();
      }
    } catch (err) {
      console.error("Failed to revoke key:", err);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Admin Management Console</h1>
        <p className="text-sm text-neutral-400">Generate invitation keys, audit active accounts, and revoke credentials.</p>
      </div>

      {/* Key Generation Section */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">Generate Invitation Keys</h2>
        <form onSubmit={handleCreateKeys} className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Key Count</label>
            <input
              type="number"
              min={1}
              max={25}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Duration (Hours)</label>
            <input
              type="number"
              min={1}
              max={720}
              value={durationHours}
              onChange={(e) => setDurationHours(parseInt(e.target.value, 10) || 1)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Access Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "user" | "admin")}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white"
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Admin Note / Recipient</label>
            <input
              type="text"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="e.g. Beta tester"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white"
            />
          </div>

          <div className="md:col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={generating}
              className="rounded-xl bg-sky-500 px-5 py-2 font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate Key(s)"}
            </button>
          </div>
        </form>
      </div>

      {/* Keys Table */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">Issued Invitation Keys</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-300">
            <thead className="border-b border-neutral-800 text-neutral-500 uppercase tracking-wider">
              <tr>
                <th className="pb-3">Key</th>
                <th className="pb-3">Role</th>
                <th className="pb-3">Note</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-mono">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-neutral-800/30">
                  <td className="py-3 text-white font-semibold">{k.key}</td>
                  <td className="py-3 capitalize text-neutral-400">{k.role}</td>
                  <td className="py-3 text-neutral-400 font-sans">{k.adminNote || "-"}</td>
                  <td className="py-3 font-sans">
                    {k.revoked ? (
                      <span className="text-rose-400">Revoked</span>
                    ) : k.isRedeemed ? (
                      <span className="text-amber-400">Redeemed</span>
                    ) : (
                      <span className="text-emerald-400">Available</span>
                    )}
                  </td>
                  <td className="py-3 text-right font-sans">
                    {!k.revoked && (
                      <button
                        onClick={() => handleRevokeKey(k.id)}
                        className="rounded px-2 py-1 text-rose-400 hover:bg-rose-950/40"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
