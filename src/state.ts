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
export interface Layout {
  version: 1;
  panes: Pane[];
  count: 2 | 4;
  focused: string;
  maximized: string | null;
  columns: number;
  rows: number;
}
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function initialLayout(): Layout {
  const panes = Array.from({ length: 4 }, () => ({
    id: randomId(),
    workspace: "",
    target: null,
    detached: false,
  }));
  return {
    version: 1,
    panes,
    count: 2,
    focused: panes[0].id,
    maximized: null,
    columns: 50,
    rows: 50,
  };
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
    const value = JSON.parse(raw ?? "null") as Layout;
    if (
      value?.version !== 1 ||
      value.panes?.length !== 4 ||
      ![2, 4].includes(value.count)
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
    return {
      ...value,
      focused: ids.has(value.focused) ? value.focused : value.panes[0].id,
      maximized:
        value.maximized && ids.has(value.maximized) ? value.maximized : null,
      columns: clamp(value.columns),
      rows: clamp(value.rows),
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
  return event.altKey && event.shiftKey && /^Digit[1-4]$/.test(event.code)
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
