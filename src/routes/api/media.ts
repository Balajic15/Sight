import { createFileRoute } from "@tanstack/react-router";
import { mediaStorageService } from "@/server/media-storage";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),
      GET: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        const url = new URL(request.url);
        const rawId = url.searchParams.get("id");
        const id = rawId ? decodeURIComponent(rawId.trim().replace(/^["']|["']$/g, "")) : null;

        if (!id) {
          return corsJson({ error: "Missing media id" }, { status: 400 });
        }

        const media = await mediaStorageService.getMedia(id, auth.session.userId, auth.session.isAdmin);
        if (!media) {
          return corsJson({ error: "Media not found" }, { status: 404 });
        }

        const uint8 = new Uint8Array(
          media.buffer.buffer,
          media.buffer.byteOffset,
          media.buffer.byteLength,
        );

        return new Response(uint8 as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": media.mimeType || "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Disposition": `inline; filename="${encodeURIComponent(media.fileName)}"`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
          },
        });
      },
    },
  },
});
