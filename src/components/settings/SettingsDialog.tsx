import React, { useState, useEffect } from "react";
import { authService } from "@/lib/auth-service";

export interface AppSettings {
  chatModel: string;
  speak: boolean;
  autoVision: boolean;
  voiceURI: string;
  rate: number;
  handsFree: boolean;
  liveVoice: string;
  cameraFacing: "environment" | "user";
  cameraResolution: "720p" | "1080p";
  screenQuality: "standard" | "high";
}

const DEFAULT_SETTINGS: AppSettings = {
  chatModel: "gemini-2.5-flash",
  speak: false,
  autoVision: false,
  voiceURI: "",
  rate: 1.0,
  handsFree: false,
  liveVoice: "Puck",
  cameraFacing: "environment",
  cameraResolution: "720p",
  screenQuality: "standard",
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChanged?: (settings: AppSettings) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  onSettingsChanged,
}) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const token = authService.getStoredToken();
        const res = await fetch("/api/settings", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = authService.getStoredToken();
      await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(settings),
      });
      onSettingsChanged?.(settings);
      onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-white">System Settings</h2>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-white">✕</button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-neutral-400">Loading preferences...</div>
        ) : (
          <div className="space-y-5 text-sm">
            {/* Model & Voice */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Model & Live Audio</h3>
              
              <div>
                <label className="block text-xs text-neutral-300 mb-1">Chat Reasoning Model</label>
                <select
                  value={settings.chatModel}
                  onChange={(e) => setSettings({ ...settings, chatModel: e.target.value })}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast, Recommended)</option>
                  <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (Ultra Low Latency)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Multimodal Reasoning)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-300 mb-1">Live Audio Voice</label>
                <select
                  value={settings.liveVoice}
                  onChange={(e) => setSettings({ ...settings, liveVoice: e.target.value })}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="Puck">Puck (Energetic, Natural)</option>
                  <option value="Charon">Charon (Deep, Authoritative)</option>
                  <option value="Kore">Kore (Warm, Calm)</option>
                  <option value="Fenrir">Fenrir (Clear, Direct)</option>
                  <option value="Aoede">Aoede (Expressive, Conversational)</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="font-medium text-neutral-200">Hands-Free Mode</div>
                  <div className="text-xs text-neutral-400">Continuous voice activity detection without push-to-talk</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.handsFree}
                  onChange={(e) => setSettings({ ...settings, handsFree: e.target.checked })}
                  className="h-5 w-5 rounded border-neutral-700 bg-neutral-800 text-sky-500"
                />
              </div>
            </div>

            {/* Camera & Vision */}
            <div className="space-y-3 pt-3 border-t border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Camera & Screen Capture</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-300 mb-1">Camera Facing</label>
                  <select
                    value={settings.cameraFacing}
                    onChange={(e) => setSettings({ ...settings, cameraFacing: e.target.value as "environment" | "user" })}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="environment">Back (Environment)</option>
                    <option value="user">Front (Selfie)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-300 mb-1">Resolution</label>
                  <select
                    value={settings.cameraResolution}
                    onChange={(e) => setSettings({ ...settings, cameraResolution: e.target.value as "720p" | "1080p" })}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="720p">720p (Faster FPS)</option>
                    <option value="1080p">1080p (High Clarity)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-5 py-2 font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
};
