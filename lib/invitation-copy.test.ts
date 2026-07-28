import { describe, expect, it, vi } from "vitest";
import { copyInvitationLink } from "./invitation-copy";

describe("copyInvitationLink", () => {
  it("copies the private invitation URL directly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyInvitationLink(
      "https://chessriot.example/join/private",
      { writeText },
    )).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "https://chessriot.example/join/private",
    );
  });

  it("reports unavailable or rejected clipboard writes without throwing", async () => {
    await expect(copyInvitationLink("https://chessriot.example/join/private", undefined))
      .resolves.toBe(false);
    await expect(copyInvitationLink("", {
      writeText: vi.fn(),
    })).resolves.toBe(false);
    await expect(copyInvitationLink("https://chessriot.example/join/private", {
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    })).resolves.toBe(false);
  });
});
