import { describe, expect, it } from "vitest";
import {
  connectionParams,
  existingPane,
  initialLayout,
  newTarget,
  parseLayout,
  paneHotkey,
  changePaneCount,
  focusPane,
  paneGrid,
  splitPositions,
  splitBounds,
} from "../src/state";
describe("per-pane state", () => {
  it("uses physical digit codes for Alt+Shift pane shortcuts on shifted layouts", () => {
    expect(paneHotkey({ code: "Digit3", altKey: true, shiftKey: true })).toBe(
      2,
    );
    expect(
      paneHotkey({ code: "Digit3", altKey: true, shiftKey: false }),
    ).toBeNull();
    expect(paneHotkey({ code: "Digit9", altKey: true, shiftKey: true })).toBe(
      8,
    );
    expect(
      paneHotkey({ code: "Digit0", altKey: true, shiftKey: true }),
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
    const l = changePaneCount(initialLayout(), 4);
    l.maximized = l.panes[1].id;
    l.columns = [63];
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
  it("accepts every pane count from one to the existing shared limit", () => {
    for (let count = 1; count <= 16; count++) {
      const layout = changePaneCount(initialLayout(), count);
      expect(layout.count).toBe(count);
      expect(layout.panes.length).toBeGreaterThanOrEqual(count);
      expect(new Set(layout.panes.map((p) => p.id)).size).toBe(
        layout.panes.length,
      );
      expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
      const grid = paneGrid(count);
      expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(count);
      expect(grid.columns).toBeLessThanOrEqual(4);
    }
    for (const invalid of [0, 17, 2.5, NaN, Infinity])
      expect(() => changePaneCount(initialLayout(), invalid)).toThrow();
  });
  it("keeps selected and hidden conversations when adding or hiding panes", () => {
    const original = changePaneCount(initialLayout(), 5);
    original.panes[4].target = newTarget("/tmp/fifth");
    original.panes[4].sessionId = "fifth-session";
    original.focused = original.panes[4].id;
    original.maximized = original.panes[4].id;
    const reduced = changePaneCount(original, 1);
    expect(reduced.panes).toBe(original.panes);
    expect(reduced.focused).toBe(original.panes[0].id);
    expect(reduced.maximized).toBeNull();
    const expanded = changePaneCount(reduced, 9);
    expect(expanded.panes.slice(0, 5)).toEqual(original.panes);
    expect(expanded.panes[4]).toBe(original.panes[4]);
    expect(expanded.panes.slice(5).every((p) => p.target === null)).toBe(true);
    expect(focusPane(reduced, original.panes[4].id)).toMatchObject({
      count: 5,
      focused: original.panes[4].id,
    });
    expect(focusPane(reduced, "missing")).toBe(reduced);
  });
  it("migrates legacy two/four-pane storage without losing hidden identities or splits", () => {
    const layout = changePaneCount(initialLayout(), 4);
    layout.panes[3].target = newTarget("/tmp/fourth");
    const migrated = parseLayout(
      JSON.stringify({
        ...layout,
        version: 1,
        count: 2,
        columns: 63,
        rows: 42,
      }),
    );
    expect(migrated).toMatchObject({
      version: 2,
      count: 2,
      columns: [63],
      rows: [42],
    });
    expect(migrated.panes).toEqual(layout.panes);
    expect(splitPositions(migrated.rows, paneGrid(4).rows)).toEqual([42]);
  });
  it("uses saved splits only for matching geometry and bounds every grid track", () => {
    expect(splitPositions([63], 2)).toEqual([63]);
    expect(splitPositions([63], 1)).toEqual([]);
    expect(splitPositions([63], 4)).toEqual([25, 50, 75]);
    expect(splitBounds([25, 50, 75], 0)).toEqual({ min: 20, max: 30 });
    expect(splitBounds([25, 50, 75], 1)).toEqual({ min: 45, max: 55 });
    const layout = changePaneCount(initialLayout(), 16);
    for (const columns of [
      [0],
      [NaN],
      [80, 20],
      [25, 30, 75],
      [20, 40, 60, 80],
    ]) {
      expect(
        parseLayout(JSON.stringify({ ...layout, columns })).panes.every(
          (p) => p.target === null,
        ),
      ).toBe(true);
      expect(parseLayout(JSON.stringify({ ...layout, columns })).count).toBe(2);
    }
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
