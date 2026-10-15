import React, { useState, useEffect } from "react";
import { Outlet, Link, createRootRoute } from "@tanstack/react-router";
import { authService, type AuthSession } from "@/lib/auth-service";
import { RedeemModal } from "@/components/auth/RedeemModal";
import { SettingsDialog, type AppSettings } from "@/components/settings/SettingsDialog";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);

  useEffect(() => {
    const checkAuth = async () => {
      const sess = await authService.validateSession();
      setSession(sess);
    };
    checkAuth();

    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100 antialiased font-sans overflow-hidden">
      {/* Top Application Bar */}
      <header className="flex h-14 w-full items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-white hover:opacity-90">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white font-mono text-base">
              A
            </span>
            <span className="text-sm font-semibold tracking-tight">Multimodal Agent</span>
          </Link>

          {!networkOnline && (
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-400 border border-rose-500/30">
              Offline
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {session?.isAdmin && (
            <Link
              to="/admin"
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition"
            >
              Admin Portal
            </Link>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-neutral-800 bg-neutral-800/60 p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white transition"
            title="Settings"
          >
            ⚙️
          </button>

          <button
            onClick={() => setRedeemOpen(true)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              session
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                : "border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${session ? "bg-emerald-400 animate-pulse" : "bg-sky-400"}`} />
            {session ? (session.isAdmin ? "Admin Key" : "Access Active") : "Redeem Key"}
          </button>
        </div>
      </header>

      {/* Main Routed Outlet */}
      <main className="flex-1 overflow-hidden relative">
        <Outlet />
      </main>

      {/* Global In-Chat Modals */}
      <RedeemModal
        isOpen={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        session={session}
        onSessionUpdated={setSession}
      />

      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
