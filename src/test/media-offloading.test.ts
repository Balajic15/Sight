import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MediaStorageService, getStorageDirectory } from "@/server/media-storage";

describe("Media Storage Offloading & Search", () => {
  const service = MediaStorageService.getInstance();
  const testUserId = "user_test_offloading_123";
  const testStorageDir = getStorageDirectory();

  it("should offload media to disk and record storagePath", async () => {
    const rawData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const attachment = await service.saveMedia({
      conversationId: "conv_test_1",
      userId: testUserId,
      fileName: "test_image.png",
      mimeType: "image/png",
      dataBase64: rawData,
      origin: "upload",
    });

    expect(attachment.id).toBeDefined();
    expect(attachment.storageRef).toContain(encodeURIComponent(attachment.id));

    // Verify it was stored on disk
    const stored = await service.getMedia(attachment.id, testUserId);
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(testUserId);
    expect(stored?.storagePath).toBeDefined();

    if (stored?.storagePath) {
      expect(fs.existsSync(stored.storagePath)).toBe(true);
      const diskContent = fs.readFileSync(stored.storagePath);
      expect(diskContent.length).toBeGreaterThan(0);
    }
  });

  it("should enforce user data isolation when reading media", async () => {
    const rawData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const attachment = await service.saveMedia({
      conversationId: "conv_test_isolated",
      userId: "user_owner_abc",
      fileName: "private.png",
      mimeType: "image/png",
      dataBase64: rawData,
      origin: "upload",
    });

    // Owner can access
    const ownerAccess = await service.getMedia(attachment.id, "user_owner_abc");
    expect(ownerAccess).not.toBeNull();

    // Another non-admin user cannot access
    const strangerAccess = await service.getMedia(attachment.id, "user_stranger_xyz", false);
    expect(strangerAccess).toBeNull();

    // Admin can access
    const adminAccess = await service.getMedia(attachment.id, "user_admin_999", true);
    expect(adminAccess).not.toBeNull();
  });

  it("should handle legacy media without disk file by falling back to base64 decoding", async () => {
    const rawData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const legacyAttachment = await service.saveMedia({
      conversationId: "conv_legacy_test",
      userId: testUserId,
      fileName: "legacy.png",
      mimeType: "image/png",
      dataBase64: rawData,
      origin: "upload",
    });

    // Clear cache to force DB retrieval
    if (globalThis.__mediaStorageCache) {
      globalThis.__mediaStorageCache.delete(legacyAttachment.id);
    }

    // Retrieve media
    const loaded = await service.getMedia(legacyAttachment.id, testUserId);
    expect(loaded).not.toBeNull();
    expect(loaded?.buffer).toBeDefined();
    expect(loaded?.buffer.length).toBeGreaterThan(0);
  });
});
