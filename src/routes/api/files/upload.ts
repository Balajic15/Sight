import { createFileRoute } from "@tanstack/react-router";
import { mediaStorageService } from "@/server/media-storage";
import { fileProcessingService } from "@/server/file-processing";
import { requireSessionAuth, corsJson, corsOptions } from "@/server/auth";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB limit

export const Route = createFileRoute("/api/files/upload")({
  server: {
    handlers: {
      OPTIONS: async () => corsOptions(),

      POST: async ({ request }) => {
        const auth = await requireSessionAuth(request);
        if (auth instanceof Response) return auth;

        try {
          const contentType = request.headers.get("content-type") || "";
          let fileName = "uploaded-file";
          let mimeType = "application/octet-stream";
          let conversationId = "default";
          let buffer: Buffer;

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file");
            if (!file || !(file instanceof Blob)) {
              return corsJson({ error: "No file provided in form data." }, { status: 400 });
            }

            if (file.size > MAX_UPLOAD_BYTES) {
              return corsJson(
                { error: "File exceeds 50MB limit. Please upload a smaller file." },
                { status: 413 },
              );
            }

            conversationId = ((formData.get("conversationId") as string) || "default").trim().slice(0, 128);
            fileName = (file.name || "uploaded-file").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 255);
            mimeType = file.type || "application/octet-stream";
            const arrayBuf = await file.arrayBuffer();
            buffer = Buffer.from(arrayBuf);
          } else {
            const body = await request.json().catch(() => null);
            if (!body || (!body.data && !body.file)) {
              return corsJson({ error: "Missing file data." }, { status: 400 });
            }

            let rawBase64 = String(body.data || body.file);
            if (rawBase64.includes(",")) {
              rawBase64 = rawBase64.split(",")[1] || rawBase64;
            }

            // Estimate decoded size from base64 string length
            if (rawBase64.length * 0.75 > MAX_UPLOAD_BYTES) {
              return corsJson(
                { error: "File exceeds 50MB limit. Please upload a smaller file." },
                { status: 413 },
              );
            }

            buffer = Buffer.from(rawBase64, "base64");
            fileName = String(body.fileName || "uploaded-file").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 255);
            mimeType = String(body.mimeType || "application/octet-stream").trim().slice(0, 100);
            conversationId = String(body.conversationId || "default").trim().slice(0, 128);
          }

          if (buffer.length > MAX_UPLOAD_BYTES) {
            return corsJson(
              { error: "File exceeds 50MB limit. Please upload a smaller file." },
              { status: 413 },
            );
          }

          const processed = await fileProcessingService.processFile(buffer, fileName, mimeType);
          const finalMime = processed.mimeType || mimeType;

          const attachment = await mediaStorageService.saveMedia({
            conversationId,
            userId: auth.session.userId,
            fileName,
            mimeType: finalMime,
            buffer,
          });

          return corsJson({
            success: true,
            attachment,
            fileType: processed.fileType,
          });
        } catch (err) {
          console.error("[api/files/upload] Upload error:", err);
          return corsJson(
            { error: (err as Error)?.message || "Failed to upload and process file." },
            { status: 500 },
          );
        }
      },
    },
  },
});
