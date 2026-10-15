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
        if (!rawId) {
          return corsJson({ error: "Missing media id" }, { status: 400 });
        }

        const id = decodeURIComponent(rawId.trim().replace(/^["']|["']$/g, ""));
        // Only accept safe alphanumeric and dash/underscore media identifiers
        if (!/^[a-zA-Z0-9_\-.:]+$/.test(id) || id.length > 256) {
          return corsJson({ error: "Invalid media id format." }, { status: 400 });
        }

        try {
          const media = await mediaStorageService.getMedia(id, auth.session.userId, auth.session.isAdmin);
          if (!media || !media.stream) {
            return corsJson({ error: "Media not found or access denied." }, { status: 404 });
          }

          const mimeType = media.item.mimeType || "application/octet-stream";
          const isSvg = mimeType.toLowerCase().includes("svg");
          const safeFileName = (media.item.fileName || "media-file").replace(/["\r\n\0]/g, "_");

          const responseHeaders: Record<string, string> = {
            "Content-Type": mimeType,
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Disposition": isSvg
              ? `attachment; filename="${encodeURIComponent(safeFileName)}"`
              : `inline; filename="${encodeURIComponent(safeFileName)}"`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "X-Content-Type-Options": "nosniff",
          };

          if (isSvg) {
            responseHeaders["Content-Security-Policy"] = "default-src 'none'; sandbox";
          }

          const uint8 = new Uint8Array(
            media.stream.buffer,
            media.stream.byteOffset,
            media.stream.byteLength,
          );

          return new Response(uint8 as unknown as BodyInit, {
            status: 200,
            headers: responseHeaders,
          });
        } catch (err) {
          console.error("[api/media] Error retrieving media item:", err);
          return corsJson({ error: "Failed to retrieve media item." }, { status: 500 });
        }
      },
    },
  },
});
