import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Conversation, Msg, Settings } from "@/lib/assistant/store";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initialized = false;

function getConnectionString(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  if (process.env["DATABASE_DIRECT_URL"]) return process.env["DATABASE_DIRECT_URL"];
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
        if (match && match[1]) return match[1].replace(/^["']|["']$/g, "").trim();
      }
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*DATABASE_DIRECT_URL\s*=\s*(.*?)\s*$/);
        if (match && match[1]) return match[1].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch {
    /* ignore read errors */
  }
  return "postgresql://postgres.gaglxhilpthujyxbobyq:aMUSYiK5vzwrhMKC@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
}

export function getDbPool(): pg.Pool {
  if (!pool) {
    const connectionString = getConnectionString();
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected database client error:", err);
    });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  const p = getDbPool();
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT,
        message_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        speak BOOLEAN NOT NULL DEFAULT true,
        auto_vision BOOLEAN NOT NULL DEFAULT true,
        voice_uri TEXT NOT NULL DEFAULT '',
        rate DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        hands_free BOOLEAN NOT NULL DEFAULT false,
        live_voice TEXT NOT NULL DEFAULT 'Zephyr',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        data_base64 TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'uploaded',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversation_images (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT,
        message_id TEXT,
        storage_path TEXT NOT NULL,
        public_url TEXT NOT NULL,
        mime_type VARCHAR(64) DEFAULT 'image/png',
        width INT DEFAULT 1024,
        height INT DEFAULT 1024,
        aspect_ratio VARCHAR(16) DEFAULT '1:1',
        original_prompt TEXT NOT NULL,
        operation_type VARCHAR(32) NOT NULL,
        parent_image_id TEXT,
        root_image_id TEXT,
        version_number INT DEFAULT 1,
        status VARCHAR(32) DEFAULT 'completed',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role VARCHAR(16) NOT NULL DEFAULT 'user',
        invitation_key_id TEXT,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        last_active_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invitation_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'AVAILABLE',
        duration_ms BIGINT DEFAULT 10800000,
        role VARCHAR(16) NOT NULL DEFAULT 'user',
        user_id TEXT,
        assigned_user_id TEXT,
        purpose VARCHAR(16) NOT NULL DEFAULT 'NEW_USER',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        redeemed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        admin_note TEXT
      );

      CREATE TABLE IF NOT EXISTS access_sessions (
        id TEXT PRIMARY KEY,
        invitation_key_id TEXT REFERENCES invitation_keys(id) ON DELETE CASCADE,
        user_id TEXT,
        session_token_hash TEXT UNIQUE NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        last_validated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_media_conversation_id ON media_items(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_images_conversation ON conversation_images(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_images_parent ON conversation_images(parent_image_id);
      CREATE INDEX IF NOT EXISTS idx_images_root ON conversation_images(root_image_id);
      CREATE INDEX IF NOT EXISTS idx_invitation_keys_hash ON invitation_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_token_hash ON access_sessions(session_token_hash);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_key_id ON access_sessions(invitation_key_id);
    `);

    // Best-effort column additions for existing installations
    await client
      .query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS user_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE access_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';")
      .catch(() => {});
    await client
      .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();")
      .catch(() => {});
    await client
      .query("ALTER TABLE invitation_keys ADD COLUMN IF NOT EXISTS user_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE invitation_keys ADD COLUMN IF NOT EXISTS assigned_user_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE invitation_keys ADD COLUMN IF NOT EXISTS purpose VARCHAR(16) NOT NULL DEFAULT 'NEW_USER';")
      .catch(() => {});
    await client
      .query("ALTER TABLE invitation_keys ADD COLUMN IF NOT EXISTS duration_ms BIGINT DEFAULT 10800000;")
      .catch(() => {});
    await client
      .query("ALTER TABLE invitation_keys ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';")
      .catch(() => {});
    await client
      .query("ALTER TABLE access_sessions ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;")
      .catch(() => {});
    await client
      .query("ALTER TABLE access_sessions ALTER COLUMN expires_at DROP NOT NULL;")
      .catch(() => {});
    await client
      .query("ALTER TABLE access_sessions ALTER COLUMN invitation_key_id DROP NOT NULL;")
      .catch(() => {});
    await client
      .query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS user_id TEXT;")
      .catch(() => {});
    await client
      .query("CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);")
      .catch(() => {});
    await client
      .query("CREATE INDEX IF NOT EXISTS idx_access_sessions_user_id ON access_sessions(user_id);")
      .catch(() => {});
    await client
      .query("CREATE INDEX IF NOT EXISTS idx_users_invitation_key ON users(invitation_key_id);")
      .catch(() => {});
    await client
      .query("CREATE INDEX IF NOT EXISTS idx_invitation_keys_assigned_user ON invitation_keys(assigned_user_id);")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS message_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS parent_image_id TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS original_prompt TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS model TEXT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS width INT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS height INT;")
      .catch(() => {});
    await client
      .query("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS storage_path TEXT;")
      .catch(() => {});
    // Populate users table from any existing conversations if missing
    await client
      .query(`
        INSERT INTO users (id, role, created_at, status, last_active_at)
        SELECT DISTINCT user_id, 'user', NOW(), 'ACTIVE', NOW()
        FROM conversations
        WHERE user_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;
      `)
      .catch(() => {});
    initialized = true;
  } finally {
    client.release();
  }
}

export async function getConversationsFromDb(
  userId?: string,
  isAdmin?: boolean,
): Promise<Conversation[]> {
  await initDb();
  const p = getDbPool();

  let convRes: pg.QueryResult;
  if (userId) {
    if (isAdmin) {
      convRes = await p.query(
        `SELECT id, title, updated_at FROM conversations 
         WHERE user_id = $1 OR user_id IS NULL OR user_id = 'admin_permanent' OR user_id = 'usr_legacy_admin'
         ORDER BY updated_at DESC LIMIT 50`,
        [userId],
      );
    } else {
      convRes = await p.query(
        `SELECT id, title, updated_at FROM conversations 
         WHERE user_id = $1 
         ORDER BY updated_at DESC LIMIT 50`,
        [userId],
      );
    }
  } else {
    convRes = await p.query(
      "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50",
    );
  }

  if (convRes.rows.length === 0) return [];

  const ids = convRes.rows.map((r) => r.id);
  let msgRes: pg.QueryResult;
  try {
    msgRes = await p.query(
      "SELECT id, conversation_id, role, text, source, attachments FROM messages WHERE conversation_id = ANY($1) ORDER BY message_order ASC, created_at ASC",
      [ids],
    );
  } catch {
    msgRes = await p.query(
      "SELECT id, conversation_id, role, text, source FROM messages WHERE conversation_id = ANY($1) ORDER BY message_order ASC, created_at ASC",
      [ids],
    );
  }

  const messagesByConv = new Map<string, Msg[]>();
  for (const m of msgRes.rows) {
    const list = messagesByConv.get(m.conversation_id) || [];
    let attachments: Msg["attachments"] = undefined;
    if (m.attachments) {
      try {
        attachments = typeof m.attachments === "string" ? JSON.parse(m.attachments) : m.attachments;
      } catch {
        /* ignore */
      }
    }
    list.push({
      id: m.id,
      role: m.role as "user" | "assistant",
      text: m.text,
      source: m.source || undefined,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
    messagesByConv.set(m.conversation_id, list);
  }

  return convRes.rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: Number(r.updated_at),
    messages: messagesByConv.get(r.id) || [],
  }));
}

export async function saveConversationToDb(
  conv: Conversation,
  userId?: string,
  isAdmin?: boolean,
): Promise<void> {
  await initDb();
  const p = getDbPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    if (userId) {
      // Verify ownership before modifying
      const existing = await client.query(
        "SELECT user_id FROM conversations WHERE id = $1 LIMIT 1",
        [conv.id],
      );
      if (existing.rows.length > 0) {
        const owner = existing.rows[0].user_id;
        if (owner && owner !== userId && !isAdmin) {
          throw new Error("Forbidden: Cannot modify a conversation belonging to another user");
        }
      }

      await client.query("SAVEPOINT conv_ins");
      try {
        await client.query(
          `INSERT INTO conversations (id, title, updated_at, user_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at, user_id = COALESCE(conversations.user_id, EXCLUDED.user_id)`,
          [conv.id, conv.title || "Untitled", conv.updatedAt || Date.now(), userId],
        );
        await client.query("RELEASE SAVEPOINT conv_ins");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT conv_ins");
        await client.query(
          `INSERT INTO conversations (id, title, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`,
          [conv.id, conv.title || "Untitled", conv.updatedAt || Date.now()],
        );
      }
    } else {
      await client.query(
        `INSERT INTO conversations (id, title, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`,
        [conv.id, conv.title || "Untitled", conv.updatedAt || Date.now()],
      );
    }

    // Delete existing messages to avoid duplicates/stale order
    await client.query("DELETE FROM messages WHERE conversation_id = $1", [conv.id]);

    for (let i = 0; i < conv.messages.length; i++) {
      const m = conv.messages[i]!;
      const attachmentsJson =
        m.attachments && m.attachments.length > 0 ? JSON.stringify(m.attachments) : null;
      await client.query("SAVEPOINT msg_ins");
      try {
        await client.query(
          `INSERT INTO messages (id, conversation_id, role, text, source, message_order, attachments)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id, role = EXCLUDED.role, text = EXCLUDED.text, source = EXCLUDED.source, message_order = EXCLUDED.message_order, attachments = EXCLUDED.attachments`,
          [m.id, conv.id, m.role, m.text, m.source || null, i, attachmentsJson],
        );
        await client.query("RELEASE SAVEPOINT msg_ins");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT msg_ins");
        await client.query(
          `INSERT INTO messages (id, conversation_id, role, text, source, message_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id, role = EXCLUDED.role, text = EXCLUDED.text, source = EXCLUDED.source, message_order = EXCLUDED.message_order`,
          [m.id, conv.id, m.role, m.text, m.source || null, i],
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConversationFromDb(
  id: string,
  userId?: string,
  isAdmin?: boolean,
): Promise<void> {
  await initDb();
  const p = getDbPool();
  if (userId) {
    const existing = await p.query("SELECT user_id FROM conversations WHERE id = $1 LIMIT 1", [id]);
    if (existing.rows.length === 0) return;
    const owner = existing.rows[0].user_id;
    if (owner && owner !== userId && !isAdmin) {
      throw new Error("Forbidden: Cannot delete a conversation belonging to another user");
    }
    await p.query("DELETE FROM conversations WHERE id = $1", [id]);
  } else {
    await p.query("DELETE FROM conversations WHERE id = $1", [id]);
  }
}

export async function clearAllConversationsFromDb(userId?: string): Promise<void> {
  await initDb();
  const p = getDbPool();
  if (userId) {
    await p.query("DELETE FROM conversations WHERE user_id = $1", [userId]);
  } else {
    await p.query("DELETE FROM conversations");
  }
}

export async function getSettingsFromDb(userId?: string): Promise<Partial<Settings> | null> {
  await initDb();
  const p = getDbPool();
  const targetId = userId && userId.trim() ? userId.trim() : "default";

  try {
    let res = await p.query(
      "SELECT chat_model, speak, auto_vision, voice_uri, rate, hands_free, live_voice, camera_facing, camera_resolution, screen_quality FROM user_settings WHERE id = $1 LIMIT 1",
      [targetId],
    );
    if (res.rows.length === 0 && targetId !== "default") {
      // Fallback to default template settings non-destructively
      res = await p.query(
        "SELECT chat_model, speak, auto_vision, voice_uri, rate, hands_free, live_voice, camera_facing, camera_resolution, screen_quality FROM user_settings WHERE id = 'default' LIMIT 1",
      );
    }
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      chatModel: row.chat_model,
      speak: row.speak,
      autoVision: row.auto_vision,
      voiceURI: row.voice_uri,
      rate: Number(row.rate),
      handsFree: row.hands_free,
      liveVoice: row.live_voice,
      cameraFacing: row.camera_facing,
      cameraResolution: row.camera_resolution,
      screenQuality: row.screen_quality,
    };
  } catch {
    // If table column migration has not occurred yet, fallback to core fields
    let res = await p.query(
      "SELECT speak, auto_vision, voice_uri, rate, hands_free, live_voice FROM user_settings WHERE id = $1 LIMIT 1",
      [targetId],
    );
    if (res.rows.length === 0 && targetId !== "default") {
      res = await p.query(
        "SELECT speak, auto_vision, voice_uri, rate, hands_free, live_voice FROM user_settings WHERE id = 'default' LIMIT 1",
      );
    }
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      speak: row.speak,
      autoVision: row.auto_vision,
      voiceURI: row.voice_uri,
      rate: Number(row.rate),
      handsFree: row.hands_free,
      liveVoice: row.live_voice,
    };
  }
}

export async function saveSettingsToDb(
  settings: Partial<Settings>,
  userId?: string,
): Promise<void> {
  await initDb();
  const p = getDbPool();
  const targetId = userId && userId.trim() ? userId.trim() : "default";

  try {
    await p.query(
      `INSERT INTO user_settings (id, user_id, chat_model, speak, auto_vision, voice_uri, rate, hands_free, live_voice, camera_facing, camera_resolution, screen_quality, updated_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (id) DO UPDATE SET
         chat_model = COALESCE($2, user_settings.chat_model),
         speak = COALESCE($3, user_settings.speak),
         auto_vision = COALESCE($4, user_settings.auto_vision),
         voice_uri = COALESCE($5, user_settings.voice_uri),
         rate = COALESCE($6, user_settings.rate),
         hands_free = COALESCE($7, user_settings.hands_free),
         live_voice = COALESCE($8, user_settings.live_voice),
         camera_facing = COALESCE($9, user_settings.camera_facing),
         camera_resolution = COALESCE($10, user_settings.camera_resolution),
         screen_quality = COALESCE($11, user_settings.screen_quality),
         updated_at = NOW()`,
      [
        targetId,
        settings.chatModel ?? "gemini-2.5-flash-lite",
        settings.speak ?? false,
        settings.autoVision ?? true,
        settings.voiceURI ?? "",
        settings.rate ?? 1.0,
        settings.handsFree ?? false,
        settings.liveVoice ?? "Zephyr",
        settings.cameraFacing ?? "environment",
        settings.cameraResolution ?? "720p",
        settings.screenQuality ?? "standard",
      ],
    );
  } catch {
    // Fallback if extra columns don't exist yet
    await p.query(
      `INSERT INTO user_settings (id, speak, auto_vision, voice_uri, rate, hands_free, live_voice, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         speak = COALESCE($2, user_settings.speak),
         auto_vision = COALESCE($3, user_settings.auto_vision),
         voice_uri = COALESCE($4, user_settings.voice_uri),
         rate = COALESCE($5, user_settings.rate),
         hands_free = COALESCE($6, user_settings.hands_free),
         live_voice = COALESCE($7, user_settings.live_voice),
         updated_at = NOW()`,
      [
        targetId,
        settings.speak ?? false,
        settings.autoVision ?? true,
        settings.voiceURI ?? "",
        settings.rate ?? 1.0,
        settings.handsFree ?? false,
        settings.liveVoice ?? "Zephyr",
      ],
    );
  }
}

export interface DbMediaItem {
  id: string;
  conversationId: string;
  userId?: string | undefined;
  messageId?: string | undefined;
  parentImageId?: string | undefined;
  originalPrompt?: string | undefined;
  model?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  origin: "generated" | "uploaded";
  storagePath?: string | undefined;
  createdAt?: string;
}

export async function saveMediaToDb(item: DbMediaItem): Promise<void> {
  await initDb();
  const p = getDbPool();
  const mediaId = item.id || crypto.randomUUID();
  try {
    await p.query(
      `INSERT INTO media_items (
        id, conversation_id, user_id, message_id, parent_image_id, original_prompt, model, width, height, file_name, mime_type, size_bytes, data_base64, origin, storage_path, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT (id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, media_items.user_id),
        message_id = COALESCE(EXCLUDED.message_id, media_items.message_id),
        parent_image_id = COALESCE(EXCLUDED.parent_image_id, media_items.parent_image_id),
        original_prompt = COALESCE(EXCLUDED.original_prompt, media_items.original_prompt),
        model = COALESCE(EXCLUDED.model, media_items.model),
        width = COALESCE(EXCLUDED.width, media_items.width),
        height = COALESCE(EXCLUDED.height, media_items.height),
        file_name = EXCLUDED.file_name,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        data_base64 = EXCLUDED.data_base64,
        storage_path = COALESCE(EXCLUDED.storage_path, media_items.storage_path)`,
      [
        mediaId,
        item.conversationId,
        item.userId || null,
        item.messageId || null,
        item.parentImageId || null,
        item.originalPrompt || null,
        item.model || null,
        item.width || null,
        item.height || null,
        item.fileName,
        item.mimeType,
        item.sizeBytes,
        item.dataBase64,
        item.origin || "uploaded",
        item.storagePath || null,
      ],
    );
  } catch {
    // Fallback if some columns are pending
    await p.query(
      `INSERT INTO media_items (id, conversation_id, file_name, mime_type, size_bytes, data_base64, origin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         data_base64 = EXCLUDED.data_base64`,
      [
        mediaId,
        item.conversationId,
        item.fileName,
        item.mimeType,
        item.sizeBytes,
        item.dataBase64,
        item.origin || "uploaded",
      ],
    );
  }
}

export async function getMediaFromDb(
  id: string,
  requestingUserId?: string,
  isAdmin?: boolean,
): Promise<DbMediaItem | null> {
  await initDb();
  const p = getDbPool();
  try {
    const res = await p.query(
      "SELECT id, conversation_id, user_id, message_id, parent_image_id, original_prompt, model, width, height, file_name, mime_type, size_bytes, data_base64, origin, storage_path, created_at FROM media_items WHERE id = $1 LIMIT 1",
      [id],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    if (requestingUserId && !isAdmin) {
      if (r.user_id && r.user_id !== requestingUserId) {
        return null;
      }
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      userId: r.user_id || undefined,
      messageId: r.message_id || undefined,
      parentImageId: r.parent_image_id || undefined,
      originalPrompt: r.original_prompt || undefined,
      model: r.model || undefined,
      width: r.width ? Number(r.width) : undefined,
      height: r.height ? Number(r.height) : undefined,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      dataBase64: r.data_base64,
      origin: r.origin as "generated" | "uploaded",
      storagePath: r.storage_path || undefined,
      createdAt: r.created_at,
    };
  } catch {
    const res = await p.query(
      "SELECT id, conversation_id, file_name, mime_type, size_bytes, data_base64, origin, created_at FROM media_items WHERE id = $1 LIMIT 1",
      [id],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      conversationId: r.conversation_id,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      dataBase64: r.data_base64,
      origin: r.origin as "generated" | "uploaded",
      createdAt: r.created_at,
    };
  }
}

export interface SearchResultsDb {
  conversations: Array<{
    id: string;
    title: string;
    updatedAt: number;
  }>;
  messages: Array<{
    id: string;
    conversationId: string;
    conversationTitle: string;
    role: string;
    text: string;
    snippet: string;
    createdAt: string;
  }>;
  media: Array<{
    id: string;
    conversationId: string;
    fileName: string;
    mimeType: string;
    prompt?: string;
    storageRef: string;
    createdAt: string;
  }>;
}

export async function searchUserContentDb(
  userId: string,
  query: string,
  limit = 20,
): Promise<SearchResultsDb> {
  await initDb();
  const p = getDbPool();
  const pattern = `%${query.trim()}%`;
  const safeLimit = Math.max(1, Math.min(50, limit));

  try {
    // 1. Search conversations
    const convRes = await p.query(
      `SELECT id, title, updated_at
       FROM conversations
       WHERE user_id = $1 AND title ILIKE $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [userId, pattern, safeLimit],
    );

    // 2. Search messages with joined conversation title
    const msgRes = await p.query(
      `SELECT m.id, m.conversation_id, c.title as conversation_title, m.role, m.text, m.created_at
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE c.user_id = $1 AND m.text ILIKE $2
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [userId, pattern, safeLimit],
    );

    // 3. Search media items
    const mediaRes = await p.query(
      `SELECT id, conversation_id, file_name, mime_type, original_prompt, created_at
       FROM media_items
       WHERE user_id = $1 AND (file_name ILIKE $2 OR original_prompt ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, pattern, safeLimit],
    );

    const conversations = convRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: Number(r.updated_at),
    }));

    const messages = msgRes.rows.map((r) => {
      const fullText = r.text || "";
      const lower = fullText.toLowerCase();
      const qLower = query.toLowerCase();
      const idx = lower.indexOf(qLower);
      let snippet = fullText;
      if (idx !== -1 && fullText.length > 120) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(fullText.length, idx + query.length + 60);
        snippet = (start > 0 ? "..." : "") + fullText.slice(start, end) + (end < fullText.length ? "..." : "");
      } else if (fullText.length > 120) {
        snippet = fullText.slice(0, 120) + "...";
      }

      return {
        id: r.id,
        conversationId: r.conversation_id,
        conversationTitle: r.conversation_title || "Untitled Chat",
        role: r.role,
        text: fullText,
        snippet,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      };
    });

    const media = mediaRes.rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      fileName: r.file_name,
      mimeType: r.mime_type,
      prompt: r.original_prompt || undefined,
      storageRef: `/api/media?id=${encodeURIComponent(r.id)}`,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    }));

    return { conversations, messages, media };
  } catch (err) {
    console.error("Error searching user content:", err);
    return { conversations: [], messages: [], media: [] };
  }
}

export interface ConversationImageRecord {
  id: string;
  conversation_id: string;
  user_id?: string | undefined;
  message_id?: string | undefined;
  storage_path: string;
  public_url: string;
  mime_type?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  aspect_ratio?: string | undefined;
  original_prompt: string;
  operation_type: "generate" | "edit" | "variation" | "reference_based";
  parent_image_id?: string | undefined;
  root_image_id?: string | undefined;
  version_number: number;
  status?: "pending" | "completed" | "failed" | undefined;
  metadata?: Record<string, unknown> | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export async function saveConversationImage(
  item: ConversationImageRecord,
): Promise<ConversationImageRecord> {
  await initDb();
  const p = getDbPool();
  await p.query(
    `INSERT INTO conversation_images (
      id, conversation_id, user_id, message_id, storage_path, public_url, mime_type, width, height, aspect_ratio,
      original_prompt, operation_type, parent_image_id, root_image_id, version_number, status, metadata, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      storage_path = EXCLUDED.storage_path,
      public_url = EXCLUDED.public_url,
      parent_image_id = EXCLUDED.parent_image_id,
      root_image_id = EXCLUDED.root_image_id,
      version_number = EXCLUDED.version_number,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()`,
    [
      item.id,
      item.conversation_id,
      item.user_id || "default",
      item.message_id || "default",
      item.storage_path,
      item.public_url,
      item.mime_type || "image/png",
      item.width || 1024,
      item.height || 1024,
      item.aspect_ratio || "1:1",
      item.original_prompt,
      item.operation_type,
      item.parent_image_id || null,
      item.root_image_id || null,
      item.version_number || 1,
      item.status || "completed",
      JSON.stringify(item.metadata || {}),
    ],
  );
  return item;
}

export async function findConversationImageById(
  id: string,
  requestingUserId?: string,
  isAdmin?: boolean,
): Promise<ConversationImageRecord | null> {
  await initDb();
  const p = getDbPool();
  const res = await p.query("SELECT * FROM conversation_images WHERE id = $1 LIMIT 1", [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  if (requestingUserId && !isAdmin) {
    if (row.user_id && row.user_id !== requestingUserId) {
      return null;
    }
  }
  return row;
}

export async function findFirstVersionImage(
  rootOrChildId: string,
): Promise<ConversationImageRecord | null> {
  await initDb();
  const p = getDbPool();
  // Find either the image with root_image_id = rootOrChildId with version 1, or the root image itself
  const res = await p.query(
    `SELECT * FROM conversation_images 
     WHERE id = $1 OR root_image_id = $1 OR id = (SELECT root_image_id FROM conversation_images WHERE id = $1)
     ORDER BY version_number ASC LIMIT 1`,
    [rootOrChildId],
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function findLatestImageByConversation(
  conversationId: string,
): Promise<ConversationImageRecord | null> {
  await initDb();
  const p = getDbPool();
  const res = await p.query(
    "SELECT * FROM conversation_images WHERE conversation_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
    [conversationId],
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function getImageLineage(rootOrImageId: string): Promise<ConversationImageRecord[]> {
  await initDb();
  const p = getDbPool();
  const res = await p.query(
    `SELECT * FROM conversation_images 
     WHERE id = $1 OR root_image_id = $1 OR root_image_id = (SELECT root_image_id FROM conversation_images WHERE id = $1)
     ORDER BY version_number ASC`,
    [rootOrImageId],
  );
  return res.rows;
}

export async function findCandidateImagesByConversation(
  conversationId: string,
  limit = 4,
): Promise<Array<{ id: string; url: string; prompt: string; versionNumber: number }>> {
  await initDb();
  const p = getDbPool();
  const res = await p.query(
    `SELECT id, public_url, original_prompt, version_number FROM conversation_images 
     WHERE conversation_id = $1 AND status = 'completed'
     ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    url: r.public_url,
    prompt: r.original_prompt,
    versionNumber: r.version_number,
  }));
}

// ============================================================================
// Invitation Key System & 3-Hour Session Authentication
// ============================================================================

export const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export function generateSecureKey(): string {
  const chars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(12);
  let str = "";
  for (let i = 0; i < 12; i++) {
    str += chars[bytes[i]! % chars.length];
  }
  return `ECHO-${str.slice(0, 4)}-${str.slice(4, 8)}-${str.slice(8, 12)}`;
}

export function getMasterAdminKey(): string {
  if (process.env["MASTER_ADMIN_KEY"]) return process.env["MASTER_ADMIN_KEY"];
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*MASTER_ADMIN_KEY\s*=\s*(.*?)\s*$/);
        if (match && match[1]) return match[1].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch {
    /* ignore read errors */
  }
  return "Balaji21a";
}

export function hashInvitationKey(rawKey: string): string {
  const normalized = rawKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export interface RedeemResult {
  success: boolean;
  sessionToken?: string;
  userId?: string;
  expiresAt?: string | null;
  remainingMs?: number | null;
  isAdmin?: boolean;
  error?: string;
}

export async function redeemInvitationKeyAtomic(rawKey: string): Promise<RedeemResult> {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return { success: false, error: "Please enter an invitation key." };
  }

  // 1. Permanent Master Administrator Key check (Balaji21a)
  const masterKey = getMasterAdminKey();
  if (trimmed === masterKey) {
    await initDb();
    const p = getDbPool();
    const permanentAdminUserId = "admin_permanent";

    // Ensure user record exists
    try {
      await p.query(
        `INSERT INTO users (id, role, created_at)
         VALUES ($1, 'admin', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [permanentAdminUserId],
      );
    } catch {
      /* ignore */
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionTokenHash = hashSessionToken(sessionToken);
    const sessionId = crypto.randomUUID();

    try {
      await p.query(
        `INSERT INTO access_sessions (
          id, session_token_hash, user_id, created_at, expires_at, last_validated_at, is_admin
        ) VALUES ($1, $2, $3, NOW(), NULL, NOW(), TRUE)`,
        [sessionId, sessionTokenHash, permanentAdminUserId],
      );
    } catch {
      await p.query(
        `INSERT INTO access_sessions (
          id, session_token_hash, created_at, expires_at, last_validated_at, is_admin
        ) VALUES ($1, $2, NOW(), NULL, NOW(), TRUE)`,
        [sessionId, sessionTokenHash],
      );
    }

    return {
      success: true,
      sessionToken,
      userId: permanentAdminUserId,
      expiresAt: null,
      remainingMs: null,
      isAdmin: true,
    };
  }

  // 2. Ordinary Key Redemption
  const keyHash = hashInvitationKey(trimmed);

  await initDb();
  const p = getDbPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    // Atomic conditional update with row lock
    const updateRes = await client.query(
      `UPDATE invitation_keys
       SET status = 'REDEEMED',
           redeemed_at = NOW(),
           expires_at = CASE
             WHEN duration_ms IS NULL OR duration_ms <= 0 THEN NULL
             ELSE NOW() + (duration_ms || ' milliseconds')::interval
           END
       WHERE id = (
         SELECT id FROM invitation_keys
         WHERE key_hash = $1
           AND status = 'AVAILABLE'
           AND revoked_at IS NULL
         FOR UPDATE
       )
       RETURNING id, expires_at, duration_ms, role, assigned_user_id, purpose`,
      [keyHash],
    );

    if (updateRes.rows.length === 0) {
      await client.query("ROLLBACK");

      // Check reason for safe feedback
      const checkRes = await p.query(
        `SELECT status, revoked_at, expires_at FROM invitation_keys WHERE key_hash = $1 LIMIT 1`,
        [keyHash],
      );

      if (checkRes.rows.length === 0) {
        return { success: false, error: "Invalid invitation key. Please check the key and try again." };
      }

      const row = checkRes.rows[0];
      if (row.revoked_at || row.status === "REVOKED") {
        return { success: false, error: "This invitation key has been revoked by an administrator." };
      }

      if (row.status === "REDEEMED" || row.status === "EXPIRED") {
        return {
          success: false,
          error:
            "This invitation key has already been redeemed and cannot be reused. Please obtain a newly generated invitation key.",
        };
      }

      return { success: false, error: "This invitation key is no longer available." };
    }

    const keyId = updateRes.rows[0].id;
    const isKeyAdmin = updateRes.rows[0].role === "admin";
    const rawExpiresAt = updateRes.rows[0].expires_at;
    const expiresAt = rawExpiresAt ? new Date(rawExpiresAt).toISOString() : null;
    const durationMs = updateRes.rows[0].duration_ms ? Number(updateRes.rows[0].duration_ms) : null;
    const assignedUserId = updateRes.rows[0].assigned_user_id
      ? String(updateRes.rows[0].assigned_user_id).trim()
      : null;

    let targetUserId: string;

    if (assignedUserId) {
      // Replacement key workflow:
      // Reuse existing permanent user ID - DO NOT create a new user record!
      targetUserId = assignedUserId;

      // Update user last_active_at and role if upgraded
      try {
        await client.query(
          `UPDATE users
           SET last_active_at = NOW(),
               role = CASE WHEN $2 = 'admin' THEN 'admin' ELSE role END
           WHERE id = $1`,
          [targetUserId, isKeyAdmin ? "admin" : "user"],
        );
      } catch {
        /* ignore */
      }
    } else {
      // New user workflow:
      // Generate unique, immutable user identity for this new user redemption
      targetUserId = `usr_${crypto.randomUUID()}`;

      try {
        await client.query(
          `INSERT INTO users (id, role, invitation_key_id, status, last_active_at, created_at)
           VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())`,
          [targetUserId, isKeyAdmin ? "admin" : "user", keyId],
        );
      } catch {
        /* ignore if schema not yet updated */
      }
    }

    // Associate user identity with invitation key
    try {
      await client.query(
        `UPDATE invitation_keys SET user_id = $1 WHERE id = $2`,
        [targetUserId, keyId],
      );
    } catch {
      /* ignore */
    }

    // High entropy 64-char hex session token
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionTokenHash = hashSessionToken(sessionToken);
    const sessionId = crypto.randomUUID();

    try {
      await client.query(
        `INSERT INTO access_sessions (
          id, invitation_key_id, user_id, session_token_hash, created_at, expires_at, last_validated_at, is_admin
        )
        VALUES ($1, $2, $3, $4, NOW(), $5, NOW(), $6)`,
        [sessionId, keyId, targetUserId, sessionTokenHash, expiresAt, isKeyAdmin],
      );
    } catch {
      await client.query(
        `INSERT INTO access_sessions (
          id, invitation_key_id, session_token_hash, created_at, expires_at, last_validated_at, is_admin
        )
        VALUES ($1, $2, $3, NOW(), $4, NOW(), $5)`,
        [sessionId, keyId, sessionTokenHash, expiresAt, isKeyAdmin],
      );
    }

    await client.query("COMMIT");

    return {
      success: true,
      sessionToken,
      userId: targetUserId,
      expiresAt,
      remainingMs: durationMs,
      isAdmin: isKeyAdmin,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error redeeming invitation key:", err);
    return { success: false, error: "Database error during key redemption. Please try again." };
  } finally {
    client.release();
  }
}

export interface SessionValidationResult {
  valid: boolean;
  session?: {
    id: string;
    invitationKeyId: string;
    userId: string;
    expiresAt: string | null;
    remainingMs: number | null;
    isAdmin: boolean;
  };
  reason?: "missing" | "invalid" | "expired" | "revoked";
}

export async function validateSessionTokenDb(token: string): Promise<SessionValidationResult> {
  if (!token || typeof token !== "string" || !token.trim()) {
    return { valid: false, reason: "missing" };
  }
  const tokenHash = hashSessionToken(token);

  await initDb();
  const p = getDbPool();
  try {
    let res: pg.QueryResult;
    try {
      res = await p.query(
        `SELECT s.id, s.invitation_key_id, s.user_id, s.expires_at, s.revoked_at as session_revoked_at,
                s.is_admin,
                k.status as key_status, k.revoked_at as key_revoked_at,
                NOW() as server_now,
                CASE
                  WHEN s.expires_at IS NOT NULL THEN EXTRACT(EPOCH FROM (s.expires_at - NOW())) * 1000
                  ELSE NULL
                END as remaining_ms
         FROM access_sessions s
         LEFT JOIN invitation_keys k ON s.invitation_key_id = k.id
         WHERE s.session_token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );
    } catch {
      res = await p.query(
        `SELECT s.id, s.invitation_key_id, s.expires_at, s.revoked_at as session_revoked_at,
                s.is_admin,
                k.status as key_status, k.revoked_at as key_revoked_at,
                NOW() as server_now,
                CASE
                  WHEN s.expires_at IS NOT NULL THEN EXTRACT(EPOCH FROM (s.expires_at - NOW())) * 1000
                  ELSE NULL
                END as remaining_ms
         FROM access_sessions s
         LEFT JOIN invitation_keys k ON s.invitation_key_id = k.id
         WHERE s.session_token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );
    }

    if (res.rows.length === 0) {
      return { valid: false, reason: "invalid" };
    }

    const row = res.rows[0];
    if (row.session_revoked_at || (row.invitation_key_id && (row.key_revoked_at || row.key_status === "REVOKED"))) {
      return { valid: false, reason: "revoked" };
    }

    const isAdmin = Boolean(row.is_admin);
    const resolvedUserId: string =
      row.user_id || (isAdmin ? "admin_permanent" : "usr_legacy");

    // If permanent administrator session: never expires!
    if (isAdmin && !row.expires_at) {
      p.query("UPDATE access_sessions SET last_validated_at = NOW() WHERE id = $1", [row.id]).catch(() => {});
      return {
        valid: true,
        session: {
          id: row.id,
          invitationKeyId: row.invitation_key_id || "master-admin",
          userId: resolvedUserId,
          expiresAt: null,
          remainingMs: null,
          isAdmin: true,
        },
      };
    }

    const remainingMs = row.remaining_ms !== null ? Math.round(Number(row.remaining_ms)) : 0;
    const isExpired = remainingMs <= 0 || new Date(row.server_now) >= new Date(row.expires_at);

    if (isExpired) {
      // Mark key as EXPIRED
      if (row.invitation_key_id) {
        p.query("UPDATE invitation_keys SET status = 'EXPIRED' WHERE id = $1 AND status != 'REVOKED'", [
          row.invitation_key_id,
        ]).catch(() => {});
      }

      return {
        valid: false,
        reason: "expired",
        session: {
          id: row.id,
          invitationKeyId: row.invitation_key_id || "",
          userId: resolvedUserId,
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          remainingMs: 0,
          isAdmin: false,
        },
      };
    }

    // Update last_validated_at asynchronously
    p.query("UPDATE access_sessions SET last_validated_at = NOW() WHERE id = $1", [row.id]).catch(() => {});
    if (resolvedUserId) {
      p.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [resolvedUserId]).catch(() => {});
    }

    return {
      valid: true,
      session: {
        id: row.id,
        invitationKeyId: row.invitation_key_id || "",
        userId: resolvedUserId,
        expiresAt: new Date(row.expires_at).toISOString(),
        remainingMs: Math.max(0, remainingMs),
        isAdmin,
      },
    };
  } catch (err) {
    console.error("Error validating session token:", err);
    return { valid: false, reason: "invalid" };
  }
}

export async function revokeSessionDb(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashSessionToken(token);
  await initDb();
  const p = getDbPool();
  try {
    const res = await p.query(
      "UPDATE access_sessions SET revoked_at = NOW() WHERE session_token_hash = $1 RETURNING id",
      [tokenHash],
    );
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

export interface UserRecord {
  id: string;
  role: "admin" | "user";
  status: string;
  createdAt: string;
  lastActiveAt?: string | null;
  conversationCount: number;
}

export async function listUsersDb(searchQuery?: string): Promise<UserRecord[]> {
  await initDb();
  const p = getDbPool();
  try {
    const trimmed = searchQuery?.trim();
    let res: pg.QueryResult;
    if (trimmed) {
      res = await p.query(
        `SELECT u.id, u.role, COALESCE(u.status, 'ACTIVE') as status, u.created_at, u.last_active_at,
                COUNT(DISTINCT c.id) as conversation_count
         FROM users u
         LEFT JOIN conversations c ON c.user_id = u.id
         WHERE u.id ILIKE $1
         GROUP BY u.id, u.role, u.status, u.created_at, u.last_active_at
         ORDER BY COALESCE(u.last_active_at, u.created_at) DESC
         LIMIT 100`,
        [`%${trimmed}%`],
      );
    } else {
      res = await p.query(
        `SELECT u.id, u.role, COALESCE(u.status, 'ACTIVE') as status, u.created_at, u.last_active_at,
                COUNT(DISTINCT c.id) as conversation_count
         FROM users u
         LEFT JOIN conversations c ON c.user_id = u.id
         GROUP BY u.id, u.role, u.status, u.created_at, u.last_active_at
         ORDER BY COALESCE(u.last_active_at, u.created_at) DESC
         LIMIT 100`,
      );
    }

    return res.rows.map((r) => ({
      id: r.id,
      role: (r.role || "user") as "admin" | "user",
      status: r.status || "ACTIVE",
      createdAt: new Date(r.created_at).toISOString(),
      lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
      conversationCount: Number(r.conversation_count || 0),
    }));
  } catch (err) {
    console.error("Failed to list users:", err);
    return [];
  }
}

export interface InvitationKeyRecord {
  id: string;
  key?: string;
  keyPrefix: string;
  status: "AVAILABLE" | "REDEEMED" | "EXPIRED" | "REVOKED";
  durationMs: number;
  role: "admin" | "user";
  assignedUserId?: string | null;
  userId?: string | null;
  purpose?: "NEW_USER" | "REPLACEMENT";
  createdAt: string;
  redeemedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  adminNote?: string | null;
  remainingMs?: number | null;
}

export async function createInvitationKeysDb(
  count = 1,
  adminNote?: string,
  durationMs = 10800000,
  role: "admin" | "user" = "user",
  assignedUserId?: string | null,
  purpose?: "NEW_USER" | "REPLACEMENT",
): Promise<{
  id: string;
  key: string;
  keyPrefix: string;
  durationMs: number;
  role: "admin" | "user";
  assignedUserId?: string | null;
  purpose: "NEW_USER" | "REPLACEMENT";
}[]> {
  const safeCount = Math.max(1, Math.min(50, count));
  const safeDurationMs = durationMs <= 0 ? 0 : Math.max(60000, durationMs); // 0 = permanent (e.g. for admin), otherwise min 1 min
  const safeRole: "admin" | "user" = role === "admin" ? "admin" : "user";
  const trimmedAssignedUser = assignedUserId?.trim() || null;
  const effectivePurpose: "NEW_USER" | "REPLACEMENT" =
    purpose || (trimmedAssignedUser ? "REPLACEMENT" : "NEW_USER");

  await initDb();
  const p = getDbPool();

  if (trimmedAssignedUser) {
    // Verify target user actually exists
    const userCheck = await p.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [trimmedAssignedUser]);
    if (userCheck.rows.length === 0) {
      throw new Error(`User ${trimmedAssignedUser} does not exist.`);
    }
  }

  const client = await p.connect();
  const created: {
    id: string;
    key: string;
    keyPrefix: string;
    durationMs: number;
    role: "admin" | "user";
    assignedUserId?: string | null;
    purpose: "NEW_USER" | "REPLACEMENT";
  }[] = [];

  try {
    await client.query("BEGIN");
    for (let i = 0; i < safeCount; i++) {
      const key = generateSecureKey();
      const keyHash = hashInvitationKey(key);
      const keyPrefix = key.slice(0, 9) + "..."; // e.g. ECHO-7K9A...
      const id = crypto.randomUUID();

      await client.query(
        `INSERT INTO invitation_keys (
          id, key_hash, key_prefix, status, duration_ms, role, assigned_user_id, purpose, created_at, admin_note
        ) VALUES ($1, $2, $3, 'AVAILABLE', $4, $5, $6, $7, NOW(), $8)`,
        [id, keyHash, keyPrefix, safeDurationMs, safeRole, trimmedAssignedUser, effectivePurpose, adminNote || null],
      );

      created.push({
        id,
        key,
        keyPrefix,
        durationMs: safeDurationMs,
        role: safeRole,
        assignedUserId: trimmedAssignedUser,
        purpose: effectivePurpose,
      });
    }
    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listInvitationKeysDb(): Promise<InvitationKeyRecord[]> {
  await initDb();
  const p = getDbPool();
  try {
    const res = await p.query(
      `SELECT id, key_prefix, status, duration_ms, role, assigned_user_id, purpose, user_id,
              created_at, redeemed_at, expires_at, revoked_at, admin_note,
              NOW() as server_now,
              CASE
                WHEN expires_at IS NOT NULL THEN EXTRACT(EPOCH FROM (expires_at - NOW())) * 1000
                ELSE NULL
              END as remaining_ms
       FROM invitation_keys
       ORDER BY created_at DESC
       LIMIT 100`,
    );

    return res.rows.map((r) => {
      let status = r.status as "AVAILABLE" | "REDEEMED" | "EXPIRED" | "REVOKED";
      const remainingMs = r.remaining_ms !== null ? Math.round(Number(r.remaining_ms)) : null;

      if (status === "REDEEMED" && remainingMs !== null && remainingMs <= 0) {
        status = "EXPIRED";
      }

      return {
        id: r.id,
        keyPrefix: r.key_prefix,
        status,
        durationMs: Number(r.duration_ms ?? 10800000),
        role: (r.role || "user") as "admin" | "user",
        assignedUserId: r.assigned_user_id || null,
        userId: r.user_id || null,
        purpose: (r.purpose || (r.assigned_user_id ? "REPLACEMENT" : "NEW_USER")) as "NEW_USER" | "REPLACEMENT",
        createdAt: new Date(r.created_at).toISOString(),
        redeemedAt: r.redeemed_at ? new Date(r.redeemed_at).toISOString() : null,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
        adminNote: r.admin_note || null,
        remainingMs: remainingMs !== null ? Math.max(0, remainingMs) : null,
      };
    });
  } catch (err) {
    console.error("Failed to list invitation keys:", err);
    return [];
  }
}

export async function revokeInvitationKeyDb(keyId: string): Promise<boolean> {
  await initDb();
  const p = getDbPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    // Revoke key
    const res = await client.query(
      `UPDATE invitation_keys
       SET status = 'REVOKED', revoked_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [keyId],
    );

    if (res.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // Revoke all linked sessions
    await client.query(
      `UPDATE access_sessions
       SET revoked_at = NOW()
       WHERE invitation_key_id = $1`,
      [keyId],
    );

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to revoke invitation key:", err);
    return false;
  } finally {
    client.release();
  }
}
