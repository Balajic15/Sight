import React, { useState } from "react";
import { authService, type AuthSession } from "@/lib/auth-service";

interface RedeemModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession | null;
  onSessionUpdated: (session: AuthSession | null) => void;
}

export const RedeemModal: React.FC<RedeemModalProps> = ({
  isOpen,
  onClose,
  session,
  onSessionUpdated,
}) => {
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authService.redeemKey(keyInput.trim());
      if (!res.success || !res.session) {
        throw new Error(res.error || "Failed to redeem invitation key.");
      }
      setSuccess("Invitation key redeemed successfully!");
      onSessionUpdated(res.session);
      setKeyInput("");
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError((err as Error).message || "Redemption failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await authService.logout();
      onSessionUpdated(null);
      onClose();
    } catch (err) {
      setError("Failed to log out cleanly.");
    } finally {
      setLoading(false);
    }
  };

  const formatExpiry = (expiresAt: number | null) => {
    if (!expiresAt) return "Permanent / Unlimited";
    const deltaMs = expiresAt - Date.now();
    if (deltaMs <= 0) return "Expired";
    const hours = Math.floor(deltaMs / (1000 * 60 * 60));
    const mins = Math.floor((deltaMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m remaining`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-white">Access & Authentication</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {session ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-neutral-800/50 p-4 border border-neutral-700/50 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-400">User ID:</span>
                <span className="font-mono text-neutral-200">{session.userId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Role:</span>
                <span className={`capitalize font-semibold ${session.isAdmin ? "text-amber-400" : "text-sky-400"}`}>
                  {session.role}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Session Status:</span>
                <span className="text-emerald-400 font-medium">{formatExpiry(session.expiresAt)}</span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              disabled={loading}
              className="w-full rounded-xl bg-rose-600/20 text-rose-400 border border-rose-500/30 py-2.5 font-medium hover:bg-rose-600 hover:text-white transition disabled:opacity-50"
            >
              {loading ? "Logging out..." : "Log Out of Session"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleRedeem} className="mt-4 space-y-4">
            <p className="text-sm text-neutral-400">
              Enter your Invitation Key to gain access to the assistant, vision models, and live audio capabilities.
            </p>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                Invitation Key
              </label>
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="INV-XXXX-XXXX-XXXX"
                className="w-full font-mono rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded-lg bg-rose-950/60 border border-rose-800/60 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg bg-emerald-950/60 border border-emerald-800/60 p-3 text-xs text-emerald-300">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !keyInput.trim()}
              className="w-full rounded-xl bg-sky-500 py-2.5 font-medium text-white hover:bg-sky-400 transition disabled:opacity-50"
            >
              {loading ? "Validating..." : "Redeem Key"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
