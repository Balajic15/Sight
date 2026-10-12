import fs from "node:fs";
import path from "node:path";
import type { AttachmentOrigin, ChatAttachment, ImageVersionNode } from "@/lib/assistant/store";
import { saveMediaToDb, getMediaFromDb, type DbMediaItem } from "./db";

export function getStorageDirectory(): string {
  const dir = process.env["STORAGE_DIR"] || path.resolve(process.cwd(), ".data", "uploads");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    /* ignore directory creation error */
  }
  return dir;
}

function getExtensionFromMime(mimeType: string, fileName?: string): string {
  if (fileName && fileName.includes(".")) {
    const ext = fileName.split(".").pop()?.trim().toLowerCase();
    if (ext && /^[a-z0-9]{1,6}$/.test(ext)) return ext;
  }
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return map[mimeType.toLowerCase()] || "bin";
}

export interface StoredMedia {
  id: string;
  conversationId: string;
  userId?: string | undefined;
  messageId?: string | undefined;
  parentImageId?: string | undefined;
  rootImageId?: string | undefined;
  versionNumber?: number | undefined;
  originalPrompt?: string | undefined;
  model?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  dataUrl?: string | undefined;
  buffer: Buffer;
  origin: AttachmentOrigin;
  storagePath?: string | undefined;
  createdAt: number;
}

declare global {
  var __mediaStorageCache: Map<string, StoredMedia> | undefined;
}

export class MediaStorageService {
  private static instance: MediaStorageService;
  private cache: Map<string, StoredMedia>;

  private constructor() {
    if (!globalThis.__mediaStorageCache) {
      globalThis.__mediaStorageCache = new Map<string, StoredMedia>();
    }
    this.cache = globalThis.__mediaStorageCache;
  }

  public static getInstance(): MediaStorageService {
    if (!MediaStorageService.instance) {
      MediaStorageService.instance = new MediaStorageService();
    }
    return MediaStorageService.instance;
  }

  public async saveMedia(params: {
    id?: string | undefined;
    conversationId: string;
    userId?: string | undefined;
    messageId?: string | undefined;
    parentImageId?: string | undefined;
    rootImageId?: string | undefined;
    versionNumber?: number | undefined;
    versions?: ImageVersionNode[] | undefined;
    fileName: string;
    mimeType: string;
    dataBase64: string;
    dataUrl?: string | undefined;
    origin: AttachmentOrigin;
    extractedText?: string | undefined;
    prompt?: string | undefined;
    model?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
  }): Promise<ChatAttachment> {
    const id = params.id || `media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let cleanBase64 = params.dataBase64;
    if (cleanBase64.includes(",")) {
      cleanBase64 = cleanBase64.split(",")[1] || cleanBase64;
    }

    const buffer = Buffer.from(cleanBase64, "base64");
    const sizeBytes = buffer.length;
    const now = Date.now();
    const dataUrl =
      params.dataUrl ||
      (params.mimeType.startsWith("image/")
        ? `data:${params.mimeType};base64,${cleanBase64}`
        : undefined);

    // Offload binary to disk storage
    let storagePath: string | undefined;
    try {
      const storageDir = getStorageDirectory();
      const userDir = params.userId ? path.join(storageDir, params.userId) : storageDir;
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      const ext = getExtensionFromMime(params.mimeType, params.fileName);
      storagePath = path.join(userDir, `${id}.${ext}`);
      fs.writeFileSync(storagePath, buffer);
    } catch (diskErr) {
      console.warn("[MediaStorageService] Disk write warning:", (diskErr as Error)?.message || diskErr);
    }

    const stored: StoredMedia = {
      id,
      conversationId: params.conversationId,
      userId: params.userId,
      messageId: params.messageId,
      parentImageId: params.parentImageId,
      rootImageId: params.rootImageId,
      versionNumber: params.versionNumber,
      originalPrompt: params.prompt,
      model: params.model,
      width: params.width,
      height: params.height,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes,
      dataBase64: cleanBase64,
      dataUrl,
      buffer,
      origin: params.origin,
      storagePath,
      createdAt: now,
    };

    // Cache locally
    this.cache.set(id, stored);

    // Persist to Postgres database reliably
    try {
      await saveMediaToDb({
        id,
        conversationId: params.conversationId,
        userId: params.userId,
        messageId: params.messageId,
        parentImageId: params.parentImageId,
        originalPrompt: params.prompt,
        model: params.model,
        width: params.width,
        height: params.height,
        fileName: params.fileName,
        mimeType: params.mimeType,
        sizeBytes,
        dataBase64: cleanBase64,
        origin: params.origin,
        storagePath,
      });
    } catch (err: unknown) {
      console.warn("[MediaStorageService] DB persist warning:", (err as Error)?.message || err);
    }

    const attachment: ChatAttachment = {
      id,
      conversationId: params.conversationId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.messageId ? { messageId: params.messageId } : {}),
      ...(params.parentImageId ? { parentImageId: params.parentImageId } : {}),
      ...(params.rootImageId ? { rootImageId: params.rootImageId } : {}),
      ...(params.versionNumber !== undefined ? { versionNumber: params.versionNumber } : {}),
      ...(params.versions ? { versions: params.versions } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.width ? { width: params.width } : {}),
      ...(params.height ? { height: params.height } : {}),
      origin: params.origin,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes,
      storageRef: `/api/media?id=${encodeURIComponent(id)}`,
      ...(dataUrl ? { dataUrl } : {}),
      status: "ready",
      ...(params.extractedText !== undefined ? { extractedText: params.extractedText } : {}),
      ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
      createdAt: now,
    };

    return attachment;
  }

  public async getMedia(
    id: string,
    requestingUserId?: string,
    isAdmin?: boolean,
  ): Promise<StoredMedia | null> {
    // Check in-memory cache first
    const cached = this.cache.get(id);
    if (cached) {
      if (requestingUserId && !isAdmin) {
        if (cached.userId && cached.userId !== requestingUserId) {
          return null;
        }
      }
      return cached;
    }

    // Check Postgres DB
    try {
      const dbItem: DbMediaItem | null = await getMediaFromDb(id, requestingUserId, isAdmin);
      if (dbItem) {
        if (requestingUserId && !isAdmin) {
          if (dbItem.userId && dbItem.userId !== requestingUserId) {
            return null;
          }
        }
        let buffer: Buffer;
        let storagePath = dbItem.storagePath;

        if (storagePath && fs.existsSync(storagePath)) {
          try {
            buffer = fs.readFileSync(storagePath);
          } catch {
            buffer = Buffer.from(dbItem.dataBase64, "base64");
          }
        } else {
          buffer = Buffer.from(dbItem.dataBase64, "base64");
          // Self-heal/cache to disk if storagePath wasn't populated or was missing
          try {
            const storageDir = getStorageDirectory();
            const userDir = dbItem.userId ? path.join(storageDir, dbItem.userId) : storageDir;
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            const ext = getExtensionFromMime(dbItem.mimeType, dbItem.fileName);
            storagePath = path.join(userDir, `${id}.${ext}`);
            fs.writeFileSync(storagePath, buffer);
          } catch {
            /* ignore cache write fail */
          }
        }

        const stored: StoredMedia = {
          id: dbItem.id,
          conversationId: dbItem.conversationId,
          userId: dbItem.userId,
          messageId: dbItem.messageId,
          parentImageId: dbItem.parentImageId,
          originalPrompt: dbItem.originalPrompt,
          model: dbItem.model,
          width: dbItem.width,
          height: dbItem.height,
          fileName: dbItem.fileName,
          mimeType: dbItem.mimeType,
          sizeBytes: dbItem.sizeBytes,
          dataBase64: dbItem.dataBase64,
          dataUrl: dbItem.mimeType.startsWith("image/")
            ? `data:${dbItem.mimeType};base64,${dbItem.dataBase64}`
            : undefined,
          buffer,
          origin: dbItem.origin,
          storagePath,
          createdAt: dbItem.createdAt ? new Date(dbItem.createdAt).getTime() : Date.now(),
        };
        this.cache.set(id, stored);
        return stored;
      }
    } catch (err) {
      console.warn("[MediaStorageService] DB retrieval error:", err);
    }

    return null;
  }

  public validateImageBuffer(buffer: Buffer): { valid: boolean; detectedMime?: string } {
    if (buffer.length < 4) return { valid: false };

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { valid: true, detectedMime: "image/png" };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, detectedMime: "image/jpeg" };
    }
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return { valid: true, detectedMime: "image/gif" };
    }
    // WEBP: 52 49 46 46 ... 57 45 42 50
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { valid: true, detectedMime: "image/webp" };
    }

    return { valid: false };
  }

  public validateVideoBuffer(buffer: Buffer): { valid: boolean; detectedMime?: string } {
    if (buffer.length < 8) return { valid: false };

    // MP4 / MOV: box type 'ftyp' at offset 4
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
      return { valid: true, detectedMime: "video/mp4" };
    }

    // WebM / Matroska: 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { valid: true, detectedMime: "video/webm" };
    }

    // QuickTime movie moov or mdat
    if (
      (buffer[4] === 0x6d && buffer[5] === 0x6f && buffer[6] === 0x6f && buffer[7] === 0x76) ||
      (buffer[4] === 0x6d && buffer[5] === 0x64 && buffer[6] === 0x61 && buffer[7] === 0x74)
    ) {
      return { valid: true, detectedMime: "video/quicktime" };
    }

    return { valid: false };
  }
}

export const mediaStorageService = MediaStorageService.getInstance();
