import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSettingsFromDb, saveSettingsToDb } from "@/server/db";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const SettingsSchema = z.object({
  chatModel: z.string().trim().max(100).optional(),
  speak: z.boolean().optional(),
  autoVision: z.boolean().optional(),
  voiceURI: z.string().trim().max(200).optional(),
  rate: z.number().min(0.5).max(2.0).optional(),
  handsFree: z.boolean().optional(),
  liveVoice: z.string().trim().max(100).optional(),
  cameraFacing: z.enum(["environment", "user"]).optional(),
  cameraResolution: z.enum(["720p", "1080p"]).optional(),
  screenQuality: z.enum(["standard", "high"]).optional(),
}).strict();

const DEFAULT_SETTINGS = {
  chatModel: "gemini-2.5-flash",
  speak: false,
  autoVision: false,
  voiceURI: "",
  rate: 1.0,
  handsFree: false,
  liveVoice: "Puck",
  cameraFacing: "environment" as const,
  cameraResolution: "720p" as const,
  screenQuality: "standard" as const,
};

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const userSettings = await getSettingsFromDb(auth.session.userId);
          return corsJson({
            ...DEFAULT_SETTINGS,
            ...(userSettings || {}),
          });
        } catch (error) {
          console.error("[api/settings] Failed to load settings from DB:", error);
          return corsJson({ error: "Failed to load user settings." }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const body = await request.json();
          const parsed = SettingsSchema.parse(body);

          const update: Record<string, unknown> = {};
          if (parsed.chatModel !== undefined) update["chatModel"] = parsed.chatModel;
          if (parsed.speak !== undefined) update["speak"] = parsed.speak;
          if (parsed.autoVision !== undefined) update["autoVision"] = parsed.autoVision;
          if (parsed.voiceURI !== undefined) update["voiceURI"] = parsed.voiceURI;
          if (parsed.rate !== undefined) update["rate"] = parsed.rate;
          if (parsed.handsFree !== undefined) update["handsFree"] = parsed.handsFree;
          if (parsed.liveVoice !== undefined) update["liveVoice"] = parsed.liveVoice;
          if (parsed.cameraFacing !== undefined) update["cameraFacing"] = parsed.cameraFacing;
          if (parsed.cameraResolution !== undefined) update["cameraResolution"] = parsed.cameraResolution;
          if (parsed.screenQuality !== undefined) update["screenQuality"] = parsed.screenQuality;

          await saveSettingsToDb(update, auth.session.userId);
          return corsJson({ success: true, settings: update });
        } catch (error) {
          const msg = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid settings payload";
          console.error("[api/settings] Failed to save settings to DB:", error);
          return corsJson({ error: msg }, { status: 400 });
        }
      },
    },
  },
});
