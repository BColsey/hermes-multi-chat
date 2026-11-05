export interface Target {
  channel: string;
  attach: string;
  resume?: string;
  cwd?: string;
}
export interface Pane {
  id: string;
  workspace: string;
  target: Target | null;
  detached: boolean;
  attempted?: boolean;
  sessionId?: string;
  title?: string;
  model?: string;
}
export const MAX_PANES = 16;
export interface Layout {
  version: 2;
  panes: Pane[];
  count: number;
  focused: string;
  maximized: string | null;
  columns: number[];
  rows: number[];
}
interface LegacyLayout extends Omit<Layout, "version" | "columns" | "rows"> {
  version: 1;
  columns: number;
  rows: number;
}
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function emptyPane(): Pane {
  return { id: randomId(), workspace: "", target: null, detached: false };
}
export function initialLayout(): Layout {
  const panes = Array.from({ length: 2 }, emptyPane);
  return {
    version: 2,
    panes,
    count: 2,
    focused: panes[0].id,
    maximized: null,
    columns: [50],
    rows: [50],
  };
}
export function changePaneCount(layout: Layout, count: number): Layout {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PANES)
    throw new Error(`Choose between 1 and ${MAX_PANES} panes.`);
  const panes =
    layout.panes.length >= count
      ? layout.panes
      : [
          ...layout.panes,
          ...Array.from({ length: count - layout.panes.length }, emptyPane),
        ];
  return {
    ...layout,
    panes,
    count,
    maximized: null,
    focused: panes.slice(0, count).some((p) => p.id === layout.focused)
      ? layout.focused
      : panes[0].id,
  };
}
export function focusPane(layout: Layout, id: string): Layout {
  const index = layout.panes.findIndex((p) => p.id === id);
  return index < 0
    ? layout
    : {
        ...layout,
        focused: id,
        count: Math.max(layout.count, index + 1),
        maximized: layout.maximized === id ? id : null,
      };
}
export function paneGrid(count: number): { columns: number; rows: number } {
  const columns = Math.min(4, Math.ceil(Math.sqrt(count)));
  return { columns, rows: Math.ceil(count / columns) };
}
export function splitPositions(saved: number[], tracks: number): number[] {
  return saved.length === tracks - 1
    ? saved
    : Array.from(
        { length: tracks - 1 },
        (_, index) => (100 * (index + 1)) / tracks,
      );
}
export function splitBounds(
  positions: number[],
  index: number,
): { min: number; max: number } {
  return {
    min: (positions[index - 1] ?? 0) + 20,
    max: (positions[index + 1] ?? 100) - 20,
  };
}
function validSplits(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every(
      (n, i) =>
        Number.isFinite(n) &&
        n >= (value[i - 1] ?? 0) + 20 &&
        n <= 100 - 20 * (value.length - i),
    )
  );
}
export function newTarget(workspace: string, resume?: string): Target {
  workspace = workspace.trim();
  if (!resume && !workspace.startsWith("/"))
    throw new Error("Choose an absolute host workspace path.");
  return {
    channel: "mc-" + randomId(),
    attach: randomId(),
    ...(resume ? { resume } : { cwd: workspace.trim() }),
  };
}
export function connectionParams(target: Target): Record<string, string> {
  return {
    channel: target.channel,
    attach: target.attach,
    profile: "default",
    ...(target.resume ? { resume: target.resume } : { cwd: target.cwd! }),
  };
}
export function parseLayout(raw: string | null): Layout {
  try {
    const value = JSON.parse(raw ?? "null") as Layout | LegacyLayout | null;
    if (
      !value ||
      ![1, 2].includes(value.version) ||
      !Array.isArray(value.panes) ||
      value.panes.length < 1 ||
      value.panes.length > MAX_PANES ||
      !Number.isInteger(value.count) ||
      value.count < 1 ||
      value.count > value.panes.length ||
      (value.version === 1 &&
        (value.panes.length !== 4 || ![2, 4].includes(value.count))) ||
      (value.version === 2 &&
        (!validSplits(value.columns) || !validSplits(value.rows)))
    )
      throw new Error();
    const ids = new Set<string>();
    const attaches = new Set<string>();
    const channels = new Set<string>();
    for (const pane of value.panes) {
      if (
        !/^[a-f0-9]{32}$/.test(pane.id) ||
        ids.has(pane.id) ||
        typeof pane.workspace !== "string" ||
        typeof pane.detached !== "boolean"
      )
        throw new Error();
      ids.add(pane.id);
      if (pane.target) {
        const t = pane.target;
        if (
          !/^[a-f0-9]{32}$/.test(t.attach) ||
          !/^mc-[a-f0-9]{32}$/.test(t.channel) ||
          attaches.has(t.attach) ||
          channels.has(t.channel)
        )
          throw new Error();
        if (t.resume ? typeof t.resume !== "string" : !t.cwd?.startsWith("/"))
          throw new Error();
        attaches.add(t.attach);
        channels.add(t.channel);
      }
    }
    const visible = new Set(value.panes.slice(0, value.count).map((p) => p.id));
    return {
      version: 2,
      panes: value.panes,
      count: value.count,
      focused: visible.has(value.focused) ? value.focused : value.panes[0].id,
      maximized:
        value.maximized && visible.has(value.maximized)
          ? value.maximized
          : null,
      columns: value.version === 1 ? [clamp(value.columns)] : value.columns,
      rows: value.version === 1 ? [clamp(value.rows)] : value.rows,
    };
  } catch {
    return initialLayout();
  }
}
export function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(20, Math.min(80, value)) : 50;
}
export function paneHotkey(
  event: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey">,
): number | null {
  return event.altKey && event.shiftKey && /^Digit[1-9]$/.test(event.code)
    ? Number(event.code.slice(-1)) - 1
    : null;
}
export function existingPane(
  panes: Pane[],
  sessionId: string,
  except: string,
  aliases: readonly string[] = [],
): Pane | undefined {
  return panes.find(
    (p) =>
      p.id !== except &&
      p.target !== null &&
      ((p.sessionId ?? p.target.resume) === sessionId ||
        aliases.includes(p.sessionId ?? p.target.resume ?? "")),
  );
}
