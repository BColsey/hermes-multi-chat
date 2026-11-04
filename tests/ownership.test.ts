import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { Ownership } from "../src/ownership";
class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
let db: IDBFactory, storage: MemoryStorage;
beforeEach(() => {
  db = new IDBFactory();
  storage = new MemoryStorage();
});
describe("HTTP-safe ownership without Web Locks", () => {
  it("atomically admits only one cloned tab, even with simultaneous claims", async () => {
    const a = new Ownership(db, storage, "doc-a"),
      b = new Ownership(db, storage, "doc-b");
    const results = await Promise.all([
      a.claim(["attach:same"], "pane-a"),
      b.claim(["attach:same"], "pane-b"),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });
  it("refuses a conversation already owned by another pane in this document", async () => {
    const a = new Ownership(db, storage, "doc-a");
    await a.claim(["session:s"], "pane-a");
    expect(await a.claim(["session:s"], "pane-b")).toMatchObject({
      pane: "pane-a",
      owner: "doc-a",
    });
  });
  it("does not expire live or crashed ownership based on a wall clock", async () => {
    const a = new Ownership(db, storage, "a"),
      b = new Ownership(db, storage, "b");
    await a.claim(["attach:x"], "p");
    expect(await b.claim(["attach:x"], "q")).not.toBeNull();
  });
  it("allows a refresh only after pagehide's explicit document release", async () => {
    const a = new Ownership(db, storage, "old"),
      b = new Ownership(db, storage, "reload");
    await a.claim(["attach:x", "session:s"], "p");
    a.releaseDocument();
    expect(await b.claim(["attach:x", "session:s"], "p")).toBeNull();
  });
  it("claims all keys or none, and cannot release another pane's reservation", async () => {
    const a = new Ownership(db, storage, "a"),
      b = new Ownership(db, storage, "b");
    await a.claim(["session:s"], "p");
    expect(await b.claim(["attach:x", "session:s"], "q")).not.toBeNull();
    expect(await a.claim(["attach:x"], "p")).toBeNull();
    await b.release(["session:s"], "q");
    expect(await b.claim(["session:s"], "q")).not.toBeNull();
  });
  it("allows explicit detach and reattach without rotating a token", async () => {
    const a = new Ownership(db, storage, "a"),
      b = new Ownership(db, storage, "b");
    await a.claim(["attach:x"], "p");
    await a.release(["attach:x"], "p");
    expect(await b.claim(["attach:x"], "q")).toBeNull();
  });
});
