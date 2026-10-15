import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const ALLOWED_MIME_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
];

const TranscribeSchema = z.object({
  audio: z.string().min(1, "Audio data is required"),
  mimeType: z
    .string()
    .trim()
    .toLowerCase()
    .refine((m) => ALLOWED_MIME_TYPES.includes(m), {
      message: "Unsupported audio MIME type.",
    })
    .default("audio/webm"),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().max(100).optional(),
});

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        let body: z.infer<typeof TranscribeSchema>;
        try {
          body = TranscribeSchema.parse(await request.json());
        } catch (err) {
          const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Invalid payload";
          return corsJson({ error: msg }, { status: 400 });
        }

        // Limit audio payload to ~25MB unencoded
        if (body.audio.length > 35 * 1024 * 1024) {
          return corsJson({ error: "Audio data exceeds maximum size limit (25MB)." }, { status: 413 });
        }

        const key =
          (body.apiKey && !body.apiKey.startsWith("nvapi-") ? body.apiKey.trim() : undefined) ||
          process.env["GOOGLE_API_KEY"];

        if (!key) {
          return corsJson(
            { error: "Google API key is not configured on the server." },
            { status: 500 },
          );
        }

        const sanitizedModel = (body.model?.trim() || "gemini-2.5-flash-lite").replace(/[^a-zA-Z0-9.\-_]/g, "");
        let base64Data = body.audio;
        if (base64Data.includes(",")) {
          base64Data = base64Data.split(",")[1] || base64Data;
        }

        const prompt =
          "Transcribe the spoken audio into plain text accurately. Output only the verbatim transcribed words with " +
          "natural capitalization and punctuation. Do not add introductory remarks, timestamps, quotation marks, or " +
          "explanations. If the audio is silent or contains no speech, output nothing.";

        // Key transmitted safely via x-goog-api-key header instead of URL parameter
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          sanitizedModel,
        )}:generateContent`;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);

          const resp = await fetch(geminiUrl, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { inline_data: { mime_type: body.mimeType, data: base64Data } },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: { temperature: 0.0, maxOutputTokens: 1024 },
            }),
          }).finally(() => clearTimeout(timeout));

          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            return corsJson(
              { error: errData.error?.message || `Transcription failed with upstream status ${resp.status}.` },
              { status: resp.status },
            );
          }

          const data = await resp.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

          return corsJson({ text });
        } catch (err) {
          const isAbort = (err as Error)?.name === "AbortError";
          return corsJson(
            { error: isAbort ? "Transcription timed out." : (err as Error)?.message || "Failed to contact transcription service." },
            { status: isAbort ? 504 : 500 },
          );
        }
      },
    },
  },
});
