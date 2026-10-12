import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initDb,
  redeemInvitationKeyAtomic,
  validateSessionTokenDb,
  getConversationsFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  clearAllConversationsFromDb,
  getSettingsFromDb,
  saveSettingsToDb,
  getMediaFromDb,
  saveMediaToDb,
  createInvitationKeysDb,
  getMasterAdminKey,
} from "@/server/db";
import { requireSessionAuth, requireAdminAuth } from "@/server/auth";
import { authService } from "@/lib/assistant/auth-service";
import {
  loadConversations,
  saveConversations,
  loadSettings,
  saveSettings,
  type Conversation,
  DEFAULT_SETTINGS,
} from "@/lib/assistant/store";
import { historyService } from "@/lib/assistant/history-service";
import { settingsService } from "@/lib/assistant/settings-service";

describe("Independent Invitation-Based Users & Strict Data Isolation", { timeout: 20000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await authService.logout();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Independent User Identity
  it("Requirement 1: Distinct ordinary invitations create distinct unique user IDs", async () => {
    // Generate two keys
    const [keyA, keyB] = await createInvitationKeysDb(2, "Test keys", 3600000, "user");
    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();

    // Redeem key A
    const redeemA = await redeemInvitationKeyAtomic(keyA!.key);
    expect(redeemA.success).toBe(true);
    expect(redeemA.userId).toBeDefined();
    expect(redeemA.userId).toMatch(/^usr_/);

    // Redeem key B
    const redeemB = await redeemInvitationKeyAtomic(keyB!.key);
    expect(redeemB.success).toBe(true);
    expect(redeemB.userId).toBeDefined();
    expect(redeemB.userId).toMatch(/^usr_/);

    // Assert user IDs are completely independent and different
    expect(redeemA.userId).not.toBe(redeemB.userId);
  });

  // 2. Strict Conversation Isolation in DB
  it("Requirement 2: User A's conversations are never visible to User B in getConversationsFromDb", async () => {
    const userA = `usr_test_a_${Date.now()}`;
    const userB = `usr_test_b_${Date.now()}`;

    const convA: Conversation = {
      id: `conv_a_${Date.now()}`,
      title: "Secret Conversation of User A",
      updatedAt: Date.now(),
      messages: [
        { id: `m_a1_${Date.now()}`, role: "user", text: "Confidential data for User A" },
        { id: `m_a2_${Date.now()}`, role: "assistant", text: "Answer for User A" },
      ],
    };

    const convB: Conversation = {
      id: `conv_b_${Date.now()}`,
      title: "Public Topic of User B",
      updatedAt: Date.now(),
      messages: [
        { id: `m_b1_${Date.now()}`, role: "user", text: "Question from User B" },
      ],
    };

    // Save conversations for their respective owners
    await saveConversationToDb(convA, userA, false);
    await saveConversationToDb(convB, userB, false);

    // Fetch as User A
    const listA = await getConversationsFromDb(userA, false);
    const idsA = listA.map((c) => c.id);
    expect(idsA).toContain(convA.id);
    expect(idsA).not.toContain(convB.id);

    // Fetch as User B
    const listB = await getConversationsFromDb(userB, false);
    const idsB = listB.map((c) => c.id);
    expect(idsB).toContain(convB.id);
    expect(idsB).not.toContain(convA.id);
  });

  // 3. Prevention of Cross-User Modification or Deletion
  it("Requirement 2 & 5: User B cannot modify or delete User A's conversation", async () => {
    const userA = `usr_owner_${Date.now()}`;
    const userB = `usr_attacker_${Date.now()}`;

    const convA: Conversation = {
      id: `conv_protected_${Date.now()}`,
      title: "User A Conversation",
      updatedAt: Date.now(),
      messages: [{ id: `m_prot_${Date.now()}`, role: "user", text: "Original text" }],
    };

    await saveConversationToDb(convA, userA, false);

    // User B tries to overwrite User A's conversation
    const maliciousEdit: Conversation = {
      id: convA.id,
      title: "Hacked title",
      updatedAt: Date.now(),
      messages: [{ id: `m_hacked_${Date.now()}`, role: "user", text: "Overwritten by attacker" }],
    };

    await expect(saveConversationToDb(maliciousEdit, userB, false)).rejects.toThrow(
      /Forbidden/i,
    );

    // User B tries to delete User A's conversation
    await expect(deleteConversationFromDb(convA.id, userB, false)).rejects.toThrow(
      /Forbidden/i,
    );

    // Verify User A's conversation is completely untouched
    const listA = await getConversationsFromDb(userA, false);
    const found = listA.find((c) => c.id === convA.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe("User A Conversation");
  });

  // 4. Strict Media Access Isolation
  it("Requirement 2: User A's uploaded media items cannot be accessed by User B", async () => {
    const userA = `usr_media_a_${Date.now()}`;
    const userB = `usr_media_b_${Date.now()}`;
    const mediaId = `media_isolated_${Date.now()}`;

    await saveMediaToDb({
      id: mediaId,
      conversationId: "conv_a",
      userId: userA,
      fileName: "financial_report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      dataBase64: Buffer.from("private financial numbers").toString("base64"),
      origin: "uploaded",
    });

    // Owner User A can retrieve it
    const mediaA = await getMediaFromDb(mediaId, userA, false);
    expect(mediaA).not.toBeNull();
    expect(mediaA?.fileName).toBe("financial_report.pdf");

    // Another user User B attempting to read it gets null (access denied)
    const mediaB = await getMediaFromDb(mediaId, userB, false);
    expect(mediaB).toBeNull();
  });

  // 5. User Settings Isolation
  it("Requirement 2: User A's settings are isolated from User B's settings", async () => {
    const userA = `usr_settings_a_${Date.now()}`;
    const userB = `usr_settings_b_${Date.now()}`;

    await saveSettingsToDb(
      { chatModel: "gemini-2.5-flash", speak: true, rate: 1.5, liveVoice: "Fenrir" },
      userA,
    );

    await saveSettingsToDb(
      { chatModel: "gemini-2.5-flash-lite", speak: false, rate: 0.8, liveVoice: "Puck" },
      userB,
    );

    const settingsA = await getSettingsFromDb(userA);
    const settingsB = await getSettingsFromDb(userB);

    expect(settingsA?.speak).toBe(true);
    expect(settingsA?.rate).toBe(1.5);
    expect(settingsA?.liveVoice).toBe("Fenrir");

    expect(settingsB?.speak).toBe(false);
    expect(settingsB?.rate).toBe(0.8);
    expect(settingsB?.liveVoice).toBe("Puck");
  });

  // 6. Independent Admin and Regular Users
  it("Requirement 3: Permanent master key Balaji21a maps to admin_permanent and does not expire", async () => {
    const masterKey = getMasterAdminKey();
    const result = await redeemInvitationKeyAtomic(masterKey);

    expect(result.success).toBe(true);
    expect(result.isAdmin).toBe(true);
    expect(result.userId).toBe("admin_permanent");
    expect(result.expiresAt).toBeNull();

    // Session validation confirms permanent admin
    const validation = await validateSessionTokenDb(result.sessionToken!);
    expect(validation.valid).toBe(true);
    expect(validation.session?.isAdmin).toBe(true);
    expect(validation.session?.userId).toBe("admin_permanent");
    expect(validation.session?.expiresAt).toBeNull();
  });

  // 7. Active Session Guard on Redemption
  it("Requirement 1 & 4: Active session guard rejects redemption if user is already authenticated without logging out", async () => {
    const [newKey] = await createInvitationKeysDb(1, "Guard test", 3600000, "user");
    expect(newKey).toBeDefined();

    // Create an active session
    const firstRedeem = await redeemInvitationKeyAtomic(newKey!.key);
    expect(firstRedeem.success).toBe(true);

    // Mock incoming request with an active valid bearer token
    const [secondKey] = await createInvitationKeysDb(1, "Second key", 3600000, "user");
    const activeReq = new Request("http://localhost:3000/api/auth/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firstRedeem.sessionToken}`,
      },
      body: JSON.stringify({ key: secondKey!.key }),
    });

    const { Route } = await import("@/routes/api/auth/redeem");
    const handler = (Route as any).options.server.handlers.POST;
    const response: Response = await handler({ request: activeReq });

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("ACTIVE_SESSION_EXISTS");
    expect(json.error).toContain("An active user session already exists");
  });

  // 8. Client Local Storage Namespacing
  it("Requirement 1 & 6: Client stores isolate conversations and settings per user ID in localStorage", () => {
    const userId1 = "usr_client_alpha";
    const userId2 = "usr_client_beta";

    const convosAlpha: Conversation[] = [
      { id: "c_alpha", title: "Alpha Chat", updatedAt: 1000, messages: [] },
    ];
    const convosBeta: Conversation[] = [
      { id: "c_beta", title: "Beta Chat", updatedAt: 2000, messages: [] },
    ];

    saveConversations(convosAlpha, userId1);
    saveConversations(convosBeta, userId2);

    expect(loadConversations(userId1)).toEqual(convosAlpha);
    expect(loadConversations(userId2)).toEqual(convosBeta);

    // User Alpha's loaded conversations do not contain Beta's conversation
    const loadedAlpha = loadConversations(userId1);
    expect(loadedAlpha.some((c) => c.id === "c_beta")).toBe(false);

    // Settings namespacing
    saveSettings({ ...DEFAULT_SETTINGS, liveVoice: "Charon" }, userId1);
    saveSettings({ ...DEFAULT_SETTINGS, liveVoice: "Aoede" }, userId2);

    expect(loadSettings(userId1).liveVoice).toBe("Charon");
    expect(loadSettings(userId2).liveVoice).toBe("Aoede");
  });

  // 9. Single-Use Key & Atomic Concurrency Guard
  it("Requirement 4: Redeeming the same invitation concurrently prevents double-use", async () => {
    const [sharedKey] = await createInvitationKeysDb(1, "Atomic test", 3600000, "user");
    expect(sharedKey).toBeDefined();

    // Trigger two redemptions concurrently
    const [res1, res2] = await Promise.all([
      redeemInvitationKeyAtomic(sharedKey!.key),
      redeemInvitationKeyAtomic(sharedKey!.key),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    // Exactly one must succeed
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0]?.error).toContain("already been redeemed");
  });

  // 10. Preserves Existing Data & Backward Compatibility
  it("Requirement 5: Preserves legacy data and does not drop or overwrite unowned legacy items", async () => {
    await initDb();
    const legacyConvId = `conv_legacy_${Date.now()}`;
    const legacyConv: Conversation = {
      id: legacyConvId,
      title: "Historical Legacy Chat",
      updatedAt: Date.now(),
      messages: [{ id: `m_leg_${Date.now()}`, role: "user", text: "Legacy message before user isolation" }],
    };

    // Save as legacy (no userId)
    await saveConversationToDb(legacyConv);

    // New ordinary user does not see legacy unassigned conversation
    const newUser = `usr_new_${Date.now()}`;
    const userList = await getConversationsFromDb(newUser, false);
    expect(userList.some((c) => c.id === legacyConvId)).toBe(false);

    // Admin user can still view legacy conversation
    const adminList = await getConversationsFromDb("admin_permanent", true);
    expect(adminList.some((c) => c.id === legacyConvId)).toBe(true);
  });
});
