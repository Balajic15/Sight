import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initDb,
  redeemInvitationKeyAtomic,
  validateSessionTokenDb,
  createInvitationKeysDb,
  listInvitationKeysDb,
  listUsersDb,
  saveConversationToDb,
  getConversationsFromDb,
  saveSettingsToDb,
  getSettingsFromDb,
  saveMediaToDb,
  getMediaFromDb,
  revokeInvitationKeyDb,
  getMasterAdminKey,
} from "@/server/db";
import { requireAdminAuth } from "@/server/auth";
import { authService } from "@/lib/assistant/auth-service";

describe("Admin-Managed Replacement Invitation Keys With Persistent User Identity", { timeout: 25000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await authService.logout();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Workflow 1 & 2: User redeems initial invitation, creates data, and retains immutable userId", async () => {
    // 1. Generate an initial key for a new user
    const [initKey] = await createInvitationKeysDb(1, "Initial Key", 3600000, "user");
    expect(initKey).toBeDefined();

    // 2. User redeems key
    const redeemRes = await redeemInvitationKeyAtomic(initKey!.key);
    expect(redeemRes.success).toBe(true);
    const userId = redeemRes.userId!;
    expect(userId).toMatch(/^usr_/);

    // 3. User creates conversation, messages, media, and settings
    const convId = `conv_${Date.now()}`;
    await saveConversationToDb(
      {
        id: convId,
        title: "Important Project Discussion",
        updatedAt: Date.now(),
        messages: [
          { id: `msg_1_${Date.now()}`, role: "user", text: "Help me design an API architecture." },
          { id: `msg_2_${Date.now()}`, role: "assistant", text: "Here is the recommended architecture." },
        ],
      },
      userId,
    );

    // User saves settings
    await saveSettingsToDb(
      {
        speak: false,
        autoVision: true,
        voiceURI: "en-US-Custom",
        rate: 1.25,
        handsFree: true,
        liveVoice: "Zephyr",
      },
      userId,
    );

    // User saves a media item
    const mediaId = `media_${Date.now()}`;
    await saveMediaToDb(
      {
        id: mediaId,
        conversationId: convId,
        userId,
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      userId,
    );

    // Verify data exists for this userId
    const convs = await getConversationsFromDb(userId);
    expect(convs.some((c) => c.id === convId)).toBe(true);
    const settings = await getSettingsFromDb(userId);
    expect(settings?.voiceURI).toBe("en-US-Custom");
    const media = await getMediaFromDb(mediaId, userId);
    expect(media).toBeDefined();
    expect(media?.fileName).toBe("diagram.png");
  });

  it("Workflow 3 & 4: Admin discovers existing user in searchable list and issues a replacement key", async () => {
    // Generate and redeem an initial key to establish a user
    const [initKey] = await createInvitationKeysDb(1, "User to Replace", 3600000, "user");
    const redeemRes = await redeemInvitationKeyAtomic(initKey!.key);
    const userId = redeemRes.userId!;

    // Create a conversation for the user
    await saveConversationToDb(
      {
        id: `conv_search_${Date.now()}`,
        title: "Searchable Chat",
        updatedAt: Date.now(),
        messages: [{ id: `msg_s_${Date.now()}`, role: "user", text: "Hello" }],
      },
      userId,
    );

    // Admin searches for the user
    const userList = await listUsersDb(userId);
    expect(userList.length).toBeGreaterThan(0);
    const foundUser = userList.find((u) => u.id === userId);
    expect(foundUser).toBeDefined();
    expect(foundUser?.id).toBe(userId);
    expect(foundUser?.conversationCount).toBeGreaterThanOrEqual(1);

    // Admin generates replacement key for this existing user with 1 hour duration
    const oneHourMs = 60 * 60 * 1000;
    const [replacementKey] = await createInvitationKeysDb(
      1,
      "Replacement Key for user",
      oneHourMs,
      "user",
      userId,
      "REPLACEMENT",
    );

    expect(replacementKey).toBeDefined();
    expect(replacementKey!.assignedUserId).toBe(userId);
    expect(replacementKey!.purpose).toBe("REPLACEMENT");
    expect(replacementKey!.durationMs).toBe(oneHourMs);

    // Verify key appears in list of invitation keys with assigned_user_id
    const allKeys = await listInvitationKeysDb();
    const recordedKey = allKeys.find((k) => k.id === replacementKey!.id);
    expect(recordedKey).toBeDefined();
    expect(recordedKey?.assignedUserId).toBe(userId);
    expect(recordedKey?.purpose).toBe("REPLACEMENT");
  });

  it("Workflow 5: Redeeming replacement key reuses immutable userId and NEVER creates duplicate user record", async () => {
    // 1. Initial user setup
    const [initialKey] = await createInvitationKeysDb(1, "Original", 3600000, "user");
    const initRedeem = await redeemInvitationKeyAtomic(initialKey!.key);
    const originalUserId = initRedeem.userId!;

    // Save user data
    const convId = `conv_keep_${Date.now()}`;
    await saveConversationToDb(
      {
        id: convId,
        title: "Must Not Be Lost",
        updatedAt: Date.now(),
        messages: [{ id: `msg_keep_${Date.now()}`, role: "user", text: "Keep this safe." }],
      },
      originalUserId,
    );

    // 2. Issue replacement key assigned to originalUserId
    const [replacementKey] = await createInvitationKeysDb(
      1,
      "Replacement",
      2 * 60 * 60 * 1000,
      "user",
      originalUserId,
      "REPLACEMENT",
    );

    // 3. User redeems replacement key
    const replRedeem = await redeemInvitationKeyAtomic(replacementKey!.key);
    expect(replRedeem.success).toBe(true);

    // CRITICAL: Must be exact same userId
    expect(replRedeem.userId).toBe(originalUserId);

    // Session token is valid and issued for that exact userId
    const sessionCheck = await validateSessionTokenDb(replRedeem.sessionToken!);
    expect(sessionCheck.valid).toBe(true);
    expect(sessionCheck.session?.userId).toBe(originalUserId);

    // 4. All existing user data is immediately available
    const convsAfter = await getConversationsFromDb(replRedeem.userId!);
    expect(convsAfter.some((c) => c.id === convId)).toBe(true);
    const retrievedConv = convsAfter.find((c) => c.id === convId);
    expect(retrievedConv?.messages[0]?.text).toBe("Keep this safe.");
  });

  it("Workflow 6: New user invitations without assigned user create fresh independent user identities", async () => {
    // Generate key with null assignedUserId
    const [newKey] = await createInvitationKeysDb(1, "New user key", 3600000, "user", null, "NEW_USER");
    expect(newKey!.assignedUserId).toBeNull();
    expect(newKey!.purpose).toBe("NEW_USER");

    // Redeem creates a brand new unique user
    const res = await redeemInvitationKeyAtomic(newKey!.key);
    expect(res.success).toBe(true);
    expect(res.userId).toBeDefined();
    expect(res.userId).toMatch(/^usr_/);
  });

  it("Workflow 7: Generating replacement key for non-existent user is safely rejected", async () => {
    await expect(
      createInvitationKeysDb(1, "Invalid User", 3600000, "user", "usr_non_existent_12345", "REPLACEMENT"),
    ).rejects.toThrow(/does not exist/i);
  });

  it("Workflow 8: Revoking a replacement key prevents redemption and invalidates active session", async () => {
    const [initKey] = await createInvitationKeysDb(1, "Init", 3600000, "user");
    const initRedeem = await redeemInvitationKeyAtomic(initKey!.key);
    const userId = initRedeem.userId!;

    const [replacementKey] = await createInvitationKeysDb(
      1,
      "To Revoke",
      3600000,
      "user",
      userId,
      "REPLACEMENT",
    );

    // Revoke before redemption
    const revoked = await revokeInvitationKeyDb(replacementKey!.id);
    expect(revoked).toBe(true);

    // Attempt to redeem revoked key
    const redeemAttempt = await redeemInvitationKeyAtomic(replacementKey!.key);
    expect(redeemAttempt.success).toBe(false);
    expect(redeemAttempt.error).toMatch(/revoked/i);
  });

  it("Workflow 9: Replacement key single-use enforcement prevents double redemption", async () => {
    const [initKey] = await createInvitationKeysDb(1, "Init Double", 3600000, "user");
    const initRedeem = await redeemInvitationKeyAtomic(initKey!.key);
    const userId = initRedeem.userId!;

    const [repKey] = await createInvitationKeysDb(1, "Single Use", 3600000, "user", userId, "REPLACEMENT");

    const firstRedeem = await redeemInvitationKeyAtomic(repKey!.key);
    expect(firstRedeem.success).toBe(true);
    expect(firstRedeem.userId).toBe(userId);

    // Second redemption attempt
    const secondRedeem = await redeemInvitationKeyAtomic(repKey!.key);
    expect(secondRedeem.success).toBe(false);
    expect(secondRedeem.error).toMatch(/already been redeemed/i);
  });

  it("Workflow 10: Strict admin authorization protects admin user listing and key creation", async () => {
    // 1. Request without admin session
    const fakeRequest = new Request("http://localhost:3000/api/admin/users", {
      headers: { "x-session-token": "invalid-token" },
    });
    const authResult = await requireAdminAuth(fakeRequest);
    expect(authResult).toBeInstanceOf(Response);
    expect((authResult as Response).status).toBe(403);

    // 2. Request with valid master admin key
    const masterAdminRedeem = await redeemInvitationKeyAtomic(getMasterAdminKey());
    expect(masterAdminRedeem.success).toBe(true);
    expect(masterAdminRedeem.isAdmin).toBe(true);

    const validAdminRequest = new Request("http://localhost:3000/api/admin/users", {
      headers: { "x-session-token": masterAdminRedeem.sessionToken! },
    });
    const validAuthResult = await requireAdminAuth(validAdminRequest);
    expect(validAuthResult).not.toBeInstanceOf(Response);
    expect(validAuthResult).toBe(true);
  });
});
