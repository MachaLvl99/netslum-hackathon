import { describe, expect, it } from "vitest";
import { deterministicPostRkey, deterministicReactionRkey, type PostSummary } from "@netslum/contracts";
import { mergeTownPosts } from "./AtprotoService.js";

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

describe("town feed optimistic projection", () => {
  const optimistic: PostSummary = {
    uri: "at://did:plc:local/app.bsky.feed.post/netslum-local",
    cid: "bafyoptimistic",
    author: { did: "did:plc:local", handle: "local.example.com" },
    text: "Welcome to paradise\n\n#netslum",
    createdAt: "2026-08-31T14:00:00.000Z"
  };

  it("shows local publications immediately and keeps newest-first order", () => {
    const older: PostSummary = {
      ...optimistic,
      uri: "at://did:plc:older/app.bsky.feed.post/older",
      cid: "bafyolder",
      createdAt: "2026-08-31T13:00:00.000Z"
    };
    expect(mergeTownPosts([optimistic], [older], 5)).toEqual([optimistic, older]);
  });

  it("deduplicates an indexed post in favor of authoritative AppView data", () => {
    const authoritative: PostSummary = {
      ...optimistic,
      author: { ...optimistic.author, displayName: "Macha" }
    };
    expect(mergeTownPosts([optimistic], [authoritative], 5)).toEqual([authoritative]);
  });
});
