import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDbPool, initDb } from "@/server/db";

export interface StoredMediaItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  userId: string;
  storageRef?: string;
  base64Data?: string;
  createdAt: number;
}

export class MediaStorageService {
  private static instance: MediaStorageService;
  private readonly storageDir: string;

  private constructor() {
    this.storageDir = process.env.STORAGE_DIR || path.join(process.cwd(), ".uploads");
  }

  public static getInstance(): MediaStorageService {
    if (!MediaStorageService.instance) {
      MediaStorageService.instance = new MediaStorageService();
    }
    return MediaStorageService.instance;
  }

  private async ensureDir() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch {}
  }

  public async saveMedia(params: {
    fileName: string;
    mimeType: string;
    buffer?: Buffer;
    base64Data?: string;
    userId: string;
    conversationId?: string;
    messageId?: string;
  }): Promise<StoredMediaItem> {
    await initDb();
    await this.ensureDir();

    const id = `med_${crypto.randomBytes(12).toString("hex")}`;
    const now = Date.now();

    let buf: Buffer;
    if (params.buffer) {
      buf = params.buffer;
    } else if (params.base64Data) {
      const cleanBase64 = params.base64Data.replace(/^data:[^;]+;base64,/, "");
      buf = Buffer.from(cleanBase64, "base64");
    } else {
      throw new Error("No buffer or base64Data provided to saveMedia.");
    }

    const safeName = `${id}_${path.basename(params.fileName).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(this.storageDir, safeName);

    await fs.writeFile(filePath, buf);

    const pool = getDbPool();
    await pool.query(
      `INSERT INTO media_items (id, user_id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        params.userId,
        params.conversationId || null,
        params.messageId || null,
        params.fileName,
        params.mimeType,
        buf.length,
        filePath,
        now,
      ],
    );

    return {
      id,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: buf.length,
      userId: params.userId,
      storageRef: filePath,
      createdAt: now,
    };
  }

  public async getMedia(
    id: string,
    userId?: string,
    isAdmin = false,
  ): Promise<{ stream?: Buffer; item: StoredMediaItem } | null> {
    await initDb();
    const pool = getDbPool();

    const res = await pool.query(`SELECT * FROM media_items WHERE id = $1`, [id]);
    if (res.rowCount === 0) return null;

    const row = res.rows[0];
    if (userId && !isAdmin && row.user_id !== userId) {
      return null;
    }

    let buffer: Buffer | undefined;
    if (row.storage_ref) {
      try {
        buffer = await fs.readFile(row.storage_ref);
      } catch {}
    }

    if (!buffer && row.base64_data) {
      buffer = Buffer.from(row.base64_data, "base64");
    }

    return {
      stream: buffer,
      item: {
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        userId: row.user_id,
        storageRef: row.storage_ref,
        createdAt: Number(row.created_at),
      },
    };
  }

  public async deleteMedia(id: string, userId: string, isAdmin = false): Promise<boolean> {
    await initDb();
    const pool = getDbPool();
    const res = await pool.query(`SELECT * FROM media_items WHERE id = $1`, [id]);
    if (res.rowCount === 0) return false;

    const row = res.rows[0];
    if (!isAdmin && row.user_id !== userId) return false;

    if (row.storage_ref) {
      try {
        await fs.unlink(row.storage_ref);
      } catch {}
    }

    await pool.query(`DELETE FROM media_items WHERE id = $1`, [id]);
    return true;
  }
}

export const mediaStorageService = MediaStorageService.getInstance();
