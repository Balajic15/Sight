import { createFileRoute } from "@tanstack/react-router";
import { mediaStorageService } from "@/server/media-storage";
import { fileProcessingService } from "@/server/file-processing";
import { requireSessionAuth } from "@/server/auth";

export const Route = createFileRoute("/api/files/upload")({
  server: {
    handlers: {
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
              return Response.json({ error: "No file provided in form data." }, { status: 400 });
            }
            conversationId = (formData.get("conversationId") as string) || "default";
            fileName = file.name || "uploaded-file";
            mimeType = file.type || "application/octet-stream";
            const arrayBuf = await file.arrayBuffer();
            buffer = Buffer.from(arrayBuf);
          } else {
            const body = await request.json();
            if (!body.data && !body.file) {
              return Response.json({ error: "Missing file data." }, { status: 400 });
            }
            let rawBase64 = (body.data || body.file) as string;
            if (rawBase64.includes(",")) {
              rawBase64 = rawBase64.split(",")[1] || rawBase64;
            }
            buffer = Buffer.from(rawBase64, "base64");
            fileName = body.fileName || "uploaded-file";
            mimeType = body.mimeType || "application/octet-stream";
            conversationId = body.conversationId || "default";
          }

          // Size limit: 50MB (supports images, documents, and video clips)
          if (buffer.length > 50 * 1024 * 1024) {
            return Response.json(
              { error: "File exceeds 50MB limit. Please upload a smaller file." },
              { status: 413 },
            );
          }

          // Process file to extract text or validate image
          const processed = await fileProcessingService.processFile(buffer, fileName, mimeType);
          const finalMime = processed.mimeType || mimeType;

          // Save to media storage
          const attachment = await mediaStorageService.saveMedia({
            conversationId,
            userId: auth.session.userId,
            fileName,
            mimeType: finalMime,
            dataBase64: buffer.toString("base64"),
            origin: "uploaded",
            extractedText: processed.extractedText,
          });

          return Response.json({
            success: true,
            attachment,
            fileType: processed.fileType,
          });
        } catch (err) {
          console.error("File upload error:", err);
          return Response.json(
            { error: (err as Error)?.message || "Failed to upload and process file." },
            { status: 500 },
          );
        }
      },
    },
  },
});
