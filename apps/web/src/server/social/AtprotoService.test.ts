import { describe, expect, it } from "vitest";
import { deterministicPostRkey, deterministicReactionRkey } from "@netslum/contracts";

describe("Atproto deterministic rkeys", () => {
  it("derives deterministic post rkeys from draft revision", () => {
    const rev = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(deterministicPostRkey(rev)).toBe("netslum-a1b2c3d4e5f60718293a4b5c");
  });

  it("derives deterministic reaction rkeys for like and repost", async () => {
    const did = "did:plc:testuser123";
    const uri = "at://did:plc:author/app.bsky.feed.post/3kabc123";
    const likeKey1 = await deterministicReactionRkey(did, "like", uri);
    const likeKey2 = await deterministicReactionRkey(did, "unlike", uri);
    expect(likeKey1).toBe(likeKey2);
    expect(likeKey1.startsWith("netslum-")).toBe(true);

    const repostKey = await deterministicReactionRkey(did, "repost", uri);
    expect(repostKey).not.toBe(likeKey1);
  });
});
