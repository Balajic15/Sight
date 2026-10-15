import { Pool, type PoolClient, type QueryResult } from "pg";
import crypto from "node:crypto";

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      process.env.POSTGRES_URL ||
      "postgres://postgres:postgres@localhost:5432/echo";

    pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl:
        process.env.NODE_ENV === "production" && !connectionString.includes("localhost")
          ? { rejectUnauthorized: false }
          : false,
    });

    pool.on("error", (err) => {
      console.error("[Database Pool Error]", err);
    });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const p = getDbPool();
    const client = await p.connect();
    try {
      await client.query("BEGIN");

      await client.query(`
        CREATE TABLE IF NOT EXISTS app_users (
          id VARCHAR(128) PRIMARY KEY,
          role VARCHAR(32) NOT NULL DEFAULT 'user',
          created_at BIGINT NOT NULL,
          last_active_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invitation_keys (
          id VARCHAR(64) PRIMARY KEY,
          key_hash VARCHAR(128) NOT NULL UNIQUE,
          role VARCHAR(32) NOT NULL DEFAULT 'user',
          duration_ms BIGINT NOT NULL DEFAULT 10800000,
          created_at BIGINT NOT NULL,
          expires_at BIGINT,
          redeemed_at BIGINT,
          assigned_user_id VARCHAR(128),
          redeemed_by_user_id VARCHAR(128),
          admin_note TEXT,
          is_revoked BOOLEAN NOT NULL DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS active_sessions (
          token_hash VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          key_id VARCHAR(64) REFERENCES invitation_keys(id) ON DELETE SET NULL,
          is_admin BOOLEAN NOT NULL DEFAULT FALSE,
          created_at BIGINT NOT NULL,
          expires_at BIGINT,
          last_active_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          title TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb
        );

        CREATE TABLE IF NOT EXISTS user_settings (
          user_id VARCHAR(128) PRIMARY KEY,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS media_items (
          id VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          conversation_id VARCHAR(128),
          message_id VARCHAR(128),
          file_name TEXT NOT NULL,
          mime_type VARCHAR(128) NOT NULL,
          size_bytes BIGINT NOT NULL,
          storage_ref TEXT,
          base64_data TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_images (
          id VARCHAR(128) PRIMARY KEY,
          conversation_id VARCHAR(128) NOT NULL,
          user_id VARCHAR(128) NOT NULL,
          url TEXT NOT NULL,
          prompt TEXT NOT NULL,
          version_number INT NOT NULL DEFAULT 1,
          parent_id VARCHAR(128),
          created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_media_user ON media_items(user_id);
        CREATE INDEX IF NOT EXISTS idx_media_conversation ON media_items(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_images_conversation ON conversation_images(conversation_id, created_at DESC);
      `);

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })();

  return initPromise;
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

export function getMasterAdminKey(): string | null {
  return process.env.ADMIN_SECRET_KEY || process.env.ADMIN_KEY || null;
}

export async function redeemInvitationKeyAtomic(key: string): Promise<{
  success: boolean;
  sessionToken?: string;
  userId?: string;
  expiresAt?: string | null;
  remainingMs?: number | null;
  isAdmin?: boolean;
  error?: string;
}> {
  await initDb();
  const pool = getDbPool();
  const client: PoolClient = await pool.connect();

  try {
    await client.query("BEGIN");
    const keyH = hashKey(key);

    const res: QueryResult = await client.query(
      `SELECT * FROM invitation_keys WHERE key_hash = $1 FOR UPDATE`,
      [keyH],
    );

    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return { success: false, error: "Invitation key is invalid." };
    }

    const row = res.rows[0];

    if (row.is_revoked) {
      await client.query("ROLLBACK");
      return { success: false, error: "This invitation key has been revoked." };
    }

    const now = Date.now();

    if (row.redeemed_at && row.expires_at && now > Number(row.expires_at)) {
      await client.query("ROLLBACK");
      return { success: false, error: "This invitation key has expired." };
    }

    let userId = row.redeemed_by_user_id || row.assigned_user_id;
    if (!userId) {
      userId = `usr_${crypto.randomBytes(10).toString("hex")}`;
    }

    const durationMs = Number(row.duration_ms) || 10800000;
    const expiresAtMs = now + durationMs;
    const isAdmin = row.role === "admin";

    await client.query(
      `INSERT INTO app_users (id, role, created_at, last_active_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (id) DO UPDATE SET last_active_at = $3`,
      [userId, row.role, now],
    );

    await client.query(
      `UPDATE invitation_keys
       SET redeemed_at = COALESCE(redeemed_at, $1),
           expires_at = $2,
           redeemed_by_user_id = $3
       WHERE id = $4`,
      [now, expiresAtMs, userId, row.id],
    );

    const rawSessionToken = `sk_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHash = hashKey(rawSessionToken);

    await client.query(
      `INSERT INTO active_sessions (token_hash, user_id, key_id, is_admin, created_at, expires_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5)`,
      [tokenHash, userId, row.id, isAdmin, now, expiresAtMs],
    );

    await client.query("COMMIT");

    return {
      success: true,
      sessionToken: rawSessionToken,
      userId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      remainingMs: durationMs,
      isAdmin,
    };
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    return { success: false, error: (err as Error)?.message || "Failed to redeem key." };
  } finally {
    client.release();
  }
}

export async function validateSessionTokenDb(token: string): Promise<{
  valid: boolean;
  session?: {
    userId: string;
    isAdmin: boolean;
    expiresAt?: string | null;
    remainingMs?: number | null;
    keyId?: string;
  };
  reason?: "expired" | "not_found" | "revoked" | "invalid";
}> {
  await initDb();
  const master = getMasterAdminKey();
  if (master && token === master) {
    return {
      valid: true,
      session: {
        userId: "admin-master",
        isAdmin: true,
        expiresAt: null,
        remainingMs: null,
      },
    };
  }

  const tokenH = hashKey(token);
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT s.*, k.is_revoked
     FROM active_sessions s
     LEFT JOIN invitation_keys k ON s.key_id = k.id
     WHERE s.token_hash = $1`,
    [tokenH],
  );

  if (res.rowCount === 0) {
    return { valid: false, reason: "not_found" };
  }

  const row = res.rows[0];

  if (row.is_revoked) {
    return { valid: false, reason: "revoked" };
  }

  const now = Date.now();
  if (row.expires_at && now > Number(row.expires_at)) {
    return {
      valid: false,
      reason: "expired",
      session: {
        userId: row.user_id,
        isAdmin: row.is_admin,
        expiresAt: new Date(Number(row.expires_at)).toISOString(),
        remainingMs: 0,
      },
    };
  }

  pool
    .query(`UPDATE active_sessions SET last_active_at = $1 WHERE token_hash = $2`, [now, tokenH])
    .catch(() => {});

  const remaining = row.expires_at ? Number(row.expires_at) - now : null;

  return {
    valid: true,
    session: {
      userId: row.user_id,
      isAdmin: Boolean(row.is_admin),
      expiresAt: row.expires_at ? new Date(Number(row.expires_at)).toISOString() : null,
      remainingMs: remaining,
      keyId: row.key_id,
    },
  };
}

export async function revokeSessionDb(token: string): Promise<boolean> {
  await initDb();
  const tokenH = hashKey(token);
  const pool = getDbPool();
  const res = await pool.query(`DELETE FROM active_sessions WHERE token_hash = $1`, [tokenH]);
  return (res.rowCount ?? 0) > 0;
}

export async function createInvitationKeysDb(params: {
  count: number;
  durationMs: number;
  adminNote?: string;
  role: "admin" | "user";
  assignedUserId?: string | null;
  purpose?: string;
}): Promise<Array<{ id: string; key: string; expiresAt: number; role: string }>> {
  await initDb();
  const pool = getDbPool();
  const client = await pool.connect();
  const out: Array<{ id: string; key: string; expiresAt: number; role: string }> = [];

  try {
    await client.query("BEGIN");
    const now = Date.now();

    for (let i = 0; i < params.count; i++) {
      const id = `key_${crypto.randomBytes(8).toString("hex")}`;
      const secret = `inv_${crypto.randomBytes(16).toString("hex")}`;
      const keyH = hashKey(secret);

      await client.query(
        `INSERT INTO invitation_keys (id, key_hash, role, duration_ms, created_at, admin_note, assigned_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          keyH,
          params.role,
          params.durationMs,
          now,
          params.adminNote || params.purpose || null,
          params.assignedUserId || null,
        ],
      );

      out.push({
        id,
        key: secret,
        expiresAt: now + params.durationMs,
        role: params.role,
      });
    }

    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listInvitationKeysDb(): Promise<unknown[]> {
  await initDb();
  const pool = getDbPool();
  const res = await pool.query(`
    SELECT id, role, duration_ms, created_at, expires_at, redeemed_at, assigned_user_id,
           redeemed_by_user_id, admin_note, is_revoked
    FROM invitation_keys
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return res.rows;
}

export async function revokeInvitationKeyDb(keyId: string): Promise<boolean> {
  await initDb();
  const pool = getDbPool();
  const res = await pool.query(`UPDATE invitation_keys SET is_revoked = TRUE WHERE id = $1`, [keyId]);
  await pool.query(`DELETE FROM active_sessions WHERE key_id = $1`, [keyId]);
  return (res.rowCount ?? 0) > 0;
}

export async function listUsersDb(filterQuery?: string): Promise<unknown[]> {
  await initDb();
  const pool = getDbPool();
  if (filterQuery) {
    const res = await pool.query(
      `SELECT * FROM app_users WHERE id ILIKE $1 ORDER BY last_active_at DESC LIMIT 100`,
      [`%${filterQuery}%`],
    );
    return res.rows;
  }
  const res = await pool.query(`SELECT * FROM app_users ORDER BY last_active_at DESC LIMIT 100`);
  return res.rows;
}

export async function saveConversationToDb(
  conv: { id: string; title: string; createdAt: number; updatedAt: number; [key: string]: unknown },
  userId: string,
  isAdmin = false,
): Promise<void> {
  await initDb();
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO conversations (id, user_id, title, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
     SET title = EXCLUDED.title,
         updated_at = EXCLUDED.updated_at,
         data = EXCLUDED.data
     WHERE conversations.user_id = $2 OR $7 = TRUE`,
    [conv.id, userId, conv.title, conv.createdAt, conv.updatedAt, JSON.stringify(conv), isAdmin],
  );
}

export async function getConversationsFromDb(userId: string, isAdmin = false): Promise<unknown[]> {
  await initDb();
  const pool = getDbPool();
  const res = isAdmin
    ? await pool.query(`SELECT data FROM conversations ORDER BY updated_at DESC LIMIT 100`)
    : await pool.query(`SELECT data FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [userId]);
  return res.rows.map((r) => r.data);
}

export async function deleteConversationFromDb(id: string, userId: string, isAdmin = false): Promise<boolean> {
  await initDb();
  const pool = getDbPool();
  const res = isAdmin
    ? await pool.query(`DELETE FROM conversations WHERE id = $1`, [id])
    : await pool.query(`DELETE FROM conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
  return (res.rowCount ?? 0) > 0;
}

export async function clearAllConversationsFromDb(userId: string): Promise<void> {
  await initDb();
  const pool = getDbPool();
  await pool.query(`DELETE FROM conversations WHERE user_id = $1`, [userId]);
}

export async function saveSettingsToDb(settings: Record<string, unknown>, userId: string): Promise<void> {
  await initDb();
  const pool = getDbPool();
  const now = Date.now();
  await pool.query(
    `INSERT INTO user_settings (user_id, settings, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
     SET settings = EXCLUDED.settings, updated_at = $3`,
    [userId, JSON.stringify(settings), now],
  );
}

export async function getSettingsFromDb(userId: string): Promise<Record<string, unknown>> {
  await initDb();
  const pool = getDbPool();
  const res = await pool.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]);
  return res.rowCount && res.rows[0].settings ? res.rows[0].settings : {};
}

export async function findCandidateImagesByConversation(
  conversationId: string,
  limit = 5,
): Promise<Array<{ id: string; url: string; prompt: string; createdAt: number }>> {
  await initDb();
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT id, url, prompt, created_at as "createdAt"
     FROM conversation_images
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );
  return res.rows;
}

export async function searchUserContentDb(
  userId: string,
  query: string,
  limit = 20,
): Promise<{ conversations: unknown[]; media: unknown[] }> {
  await initDb();
  const pool = getDbPool();
  const q = `%${query}%`;

  const convRes = await pool.query(
    `SELECT data FROM conversations
     WHERE user_id = $1 AND (title ILIKE $2 OR data::text ILIKE $2)
     ORDER BY updated_at DESC LIMIT $3`,
    [userId, q, limit],
  );

  const mediaRes = await pool.query(
    `SELECT id, file_name, mime_type, size_bytes, created_at
     FROM media_items
     WHERE user_id = $1 AND file_name ILIKE $2
     ORDER BY created_at DESC LIMIT $3`,
    [userId, q, limit],
  );

  return {
    conversations: convRes.rows.map((r) => r.data),
    media: mediaRes.rows,
  };
}
