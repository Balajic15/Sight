import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSettingsFromDb, saveSettingsToDb } from "@/server/db";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const SettingsSchema = z.object({
  chatModel: z.string().optional(),
  speak: z.boolean().optional(),
  autoVision: z.boolean().optional(),
  voiceURI: z.string().optional(),
  rate: z.number().min(0.5).max(2.0).optional(),
  handsFree: z.boolean().optional(),
  liveVoice: z.string().optional(),
  cameraFacing: z.enum(["environment", "user"]).optional(),
  cameraResolution: z.enum(["720p", "1080p"]).optional(),
  screenQuality: z.enum(["standard", "high"]).optional(),
});

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const settings = await getSettingsFromDb(auth.session.userId);
          return corsJson(settings || {});
        } catch (error) {
          console.error("Failed to load settings from DB:", error);
          return corsJson({ error: "Failed to load settings" }, { status: 500 });
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
          if (parsed.cameraResolution !== undefined)
            update["cameraResolution"] = parsed.cameraResolution;
          if (parsed.screenQuality !== undefined) update["screenQuality"] = parsed.screenQuality;
          await saveSettingsToDb(update, auth.session.userId);
          return corsJson({ success: true });
        } catch (error) {
          console.error("Failed to save settings to DB:", error);
          return corsJson({ error: "Failed to save settings" }, { status: 400 });
        }
      },
    },
  },
});
