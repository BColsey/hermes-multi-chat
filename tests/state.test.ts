import { describe, expect, it } from "vitest";
import {
  connectionParams,
  existingPane,
  initialLayout,
  newTarget,
  parseLayout,
  paneHotkey,
} from "../src/state";
describe("per-pane state", () => {
  it("uses physical digit codes for Alt+Shift pane shortcuts on shifted layouts", () => {
    expect(paneHotkey({ code: "Digit3", altKey: true, shiftKey: true })).toBe(
      2,
    );
    expect(
      paneHotkey({ code: "Digit3", altKey: true, shiftKey: false }),
    ).toBeNull();
    expect(
      paneHotkey({ code: "Digit9", altKey: true, shiftKey: true }),
    ).toBeNull();
  });
  it("creates independent channel and attachment identities", () => {
    const a = newTarget("/tmp/project-a"),
      b = newTarget("/tmp/project-b");
    expect(a.channel).not.toBe(b.channel);
    expect(a.attach).not.toBe(b.attach);
    expect(connectionParams(a)).toMatchObject({
      cwd: "/tmp/project-a",
      profile: "default",
    });
    expect(connectionParams(b).cwd).toBe("/tmp/project-b");
  });
  it("pins reconnect identity and never turns a new connection into a resume key", () => {
    const t = newTarget("/tmp/a");
    expect(connectionParams(t)).toEqual(connectionParams(structuredClone(t)));
    expect(connectionParams(t)).not.toHaveProperty("fresh");
    expect(connectionParams(t)).not.toHaveProperty("prompt");
  });
  it("does not override a resumed conversation workspace", () => {
    expect(
      connectionParams(newTarget("/tmp/wrong", "session-1")),
    ).toMatchObject({ resume: "session-1" });
    expect(
      connectionParams(newTarget("/tmp/wrong", "session-1")),
    ).not.toHaveProperty("cwd");
  });
  it("trims an explicitly entered workspace before validating it", () => {
    expect(newTarget(" /tmp/a ").cwd).toBe("/tmp/a");
  });
  it("rejects ambiguous fresh workspace selection", () => {
    expect(() => newTarget("")).toThrow();
    expect(() => newTarget("relative")).toThrow();
  });
  it("preserves layout and connection selections without transcript/input", () => {
    const l = initialLayout();
    l.count = 4;
    l.maximized = l.panes[1].id;
    l.columns = 63;
    l.panes[0].target = newTarget("/tmp/a");
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
    expect(Object.keys(l.panes[0])).not.toContain("prompt");
  });
  it("fails closed on corrupted/colliding stored identities", () => {
    const l = initialLayout();
    l.panes[0].target = newTarget("/tmp/a");
    l.panes[1].target = l.panes[0].target;
    expect(
      parseLayout(JSON.stringify(l)).panes.every((p) => p.target === null),
    ).toBe(true);
    expect(parseLayout("{")).toMatchObject({ count: 2 });
  });
  it("focuses a selected session instead of creating another writer", () => {
    const l = initialLayout();
    l.panes[0].target = newTarget("", "s1");
    l.panes[0].sessionId = "s1";
    expect(existingPane(l.panes, "s1", l.panes[1].id)?.id).toBe(l.panes[0].id);
    l.panes[0].sessionId = "s2";
    expect(existingPane(l.panes, "s1", l.panes[1].id)).toBeUndefined();
    l.panes[0].target = null;
    expect(existingPane(l.panes, "s2", l.panes[1].id)).toBeUndefined();
  });
});
