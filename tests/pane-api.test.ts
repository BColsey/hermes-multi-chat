import { describe, it, expect, vi } from "vitest";
import { PaneAPI } from "../src/pane-api";
import { newTarget } from "../src/state";
describe("observed retained PTY", () => {
  it("permits just one explicit create and refuses to respawn after retention is lost", async () => {
    const attempted = vi.fn(),
      target = newTarget("/tmp/a");
    const api = new PaneAPI(
      target,
      async () => ({ retained: false }),
      true,
      attempted,
    );
    expect(await api.params()).toMatchObject({
      cwd: "/tmp/a",
      profile: "default",
    });
    await expect(api.params()).rejects.toThrow(/retained/);
    expect(attempted).toHaveBeenCalledOnce();
  });
  it("never treats refresh as permission to create another agent", async () => {
    const api = new PaneAPI(
      newTarget("/tmp/a"),
      async () => ({ retained: false }),
      false,
      () => {},
    );
    await expect(api.params()).rejects.toThrow(/retained/);
  });
  it("uses the actual opaque registry key and omits resume to avoid canonicalization/takeover", async () => {
    const target = newTarget("", "old-before-compression");
    const params = {
      channel: target.channel,
      attach: target.attach + "\0default\0actual-registry-target",
    };
    const api = new PaneAPI(
      target,
      async () => ({ retained: true, session_id: "current-after-new", params }),
      false,
      () => {},
    );
    expect(await api.params()).toEqual(params);
    expect(await api.params()).not.toHaveProperty("resume");
  });
  it("fails closed on a mismatched channel or attachment response", async () => {
    const target = newTarget("/tmp/a");
    const api = new PaneAPI(
      target,
      async () => ({
        retained: true,
        session_id: "s",
        params: { channel: "another", attach: "another" },
      }),
      false,
      () => {},
    );
    await expect(api.params()).rejects.toThrow(/identity/);
  });
});
