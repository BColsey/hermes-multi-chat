import { React, sdk, type SessionRow, type WorkspaceData } from "./sdk";
import {
  clamp,
  existingPane,
  paneHotkey,
  newTarget,
  parseLayout,
  type Layout,
  type Pane,
} from "./state";
import {
  browserOwnership,
  TerminalHost,
  type TerminalControls,
} from "./TerminalHost";
import type { ConnectionState, SessionMetadata } from "./transport";

const STORAGE_KEY = "hermes.multi-chat.default.v1";
const RESTORE_WINDOW = 29 * 60 * 1000;
interface SavedLayout extends Layout {
  savedAt?: number;
}
function restore(): Layout {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const layout = parseLayout(raw);
    for (const pane of layout.panes) if (pane.target) pane.attempted = true;
    const savedAt =
      (JSON.parse(raw ?? "null") as SavedLayout | null)?.savedAt ?? 0;
    if (Date.now() - savedAt > RESTORE_WINDOW)
      for (const pane of layout.panes) if (pane.target) pane.detached = true;
    return layout;
  } catch {
    return parseLayout(null);
  }
}

interface PaneProps {
  pane: Pane;
  index: number;
  focused: boolean;
  maximized: boolean;
  hidden: boolean;
  workspaces: WorkspaceData | null;
  sessions: SessionRow[];
  update(patch: Partial<Pane>): void;
  focus(): void;
  maximize(): void;
  resume(id: string): Promise<void>;
  refreshSessions(): void;
  conflict(pane: string | null): void;
}
function ChatPane(props: PaneProps) {
  const [connection, setConnection] =
    React.useState<ConnectionState>("connecting");
  const [detail, setDetail] = React.useState("");
  const [error, setError] = React.useState("");
  const [resumeId, setResumeId] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [opening, setOpening] = React.useState(false);
  const controls = React.useRef<TerminalControls | null>(null);
  const p = props.pane;
  const active = p.target && !p.detached;
  const state = !p.target ? "empty" : p.detached ? "detached" : connection;
  const resume = async () => {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      await props.resume(resumeId.trim());
    } catch {
      setError(
        "Could not resolve that default-profile conversation. Check its ID and sign-in, then try again.",
      );
    } finally {
      setOpening(false);
    }
  };
  const detach = () => {
    if (
      !window.confirm(
        "Close this view only? This does NOT stop work. Use /stop in this TUI first if you intend to interrupt its current turn. Detached PTYs are retained for up to 30 minutes, possibly less under capacity pressure or on dashboard restart. Gateway-owned work has separate cleanup and may outlive the terminal; retention is not a work deadline or an indefinite-running guarantee. Unsaved input is not restored.",
      )
    )
      return;
    props.update({ detached: true });
  };
  const recover = async () => {
    if (!p.target) return;
    if (
      !window.confirm(
        "Recover this view's stale browser reservation? Only continue after closing its other Multi Chat tabs. This may take over another terminal or interrupt an active session. No prompt will be resent.",
      )
    )
      return;
    try {
      await browserOwnership().recover([
        "attach:" + p.target.attach,
        ...(p.sessionId ? ["session:" + p.sessionId] : []),
        ...(p.target.resume ? ["session:" + p.target.resume] : []),
      ]);
      setRetry((n) => n + 1);
    } catch {
      setError("Browser storage recovery failed. No terminal was opened.");
    }
  };
  const options = new Map<string, string>();
  if (props.workspaces?.default_cwd)
    options.set(props.workspaces.default_cwd, "Dashboard starting directory");
  for (const project of props.workspaces?.projects ?? [])
    if (!project.archived) {
      const folders = project.folders.length
        ? project.folders
        : project.primary_path
          ? [{ path: project.primary_path, label: null }]
          : [];
      for (const folder of folders)
        options.set(
          folder.path,
          project.name + (folder.label ? " · " + folder.label : ""),
        );
    }
  for (const repo of props.workspaces?.repos ?? [])
    if (!options.has(repo.root)) options.set(repo.root, repo.label);
  return (
    <section
      className={`mc-pane ${props.focused ? "mc-focused" : ""}`}
      hidden={props.hidden}
      style={{
        gridArea: `${Math.floor(props.index / 2) + 1} / ${(props.index % 2) + 1}`,
      }}
      aria-label={`Chat pane ${props.index + 1}`}
      data-pane={props.index + 1}
      data-session={p.sessionId ?? ""}
      data-connection={state}
      onFocusCapture={props.focus}
      onPointerDownCapture={props.focus}
    >
      <header className="mc-pane-heading">
        <button
          className="mc-pane-focus"
          aria-label={`Focus pane ${props.index + 1}`}
          onClick={() => {
            props.focus();
            controls.current?.focus();
          }}
        >
          <span className="mc-number">{props.index + 1}</span>
          <span className="mc-title" title={p.title || "New conversation"}>
            {p.title || `Conversation ${props.index + 1}`}
          </span>
        </button>
        <span className={`mc-state mc-${state}`} role="status">
          {state}
        </span>
        <button
          aria-label={
            props.maximized
              ? `Restore pane ${props.index + 1}`
              : `Maximize pane ${props.index + 1}`
          }
          onClick={props.maximize}
        >
          {props.maximized ? "Restore" : "Maximize"}
        </button>
        {active && (
          <button
            onClick={detach}
            title="Detach only; use /stop inside the TUI to interrupt its turn"
          >
            Close view
          </button>
        )}
      </header>
      <div className="mc-workspace" title={p.workspace || "Choose a workspace"}>
        {p.workspace || "No workspace selected"}
      </div>
      {active ? (
        <>
          <div className="mc-terminal-toolbar">
            <span title={p.model}>{p.model || "Model: loading…"}</span>
            <span className="mc-session-id" title={p.sessionId}>
              {p.sessionId || "Waiting for session identity…"}
            </span>
            <button
              onClick={() => {
                void controls.current?.copy().then((ok) => {
                  if (!ok)
                    setError(
                      "Select terminal text first. If copy is blocked, use your browser's copy menu.",
                    );
                });
              }}
            >
              Copy selection
            </button>
          </div>
          <TerminalHost
            pane={p}
            retry={retry}
            controls={controls}
            onState={(s, d) => {
              setConnection(s);
              setDetail(d);
            }}
            onAttempt={() => props.update({ attempted: true })}
            onMetadata={(info: SessionMetadata) => {
              props.update(info);
            }}
            onConflict={props.conflict}
          />
          {connection !== "connected" && (
            <div className="mc-notice" role="status">
              {detail || "Connecting…"}
              {["error", "conflict"].includes(connection) && (
                <>
                  <button onClick={() => setRetry((n) => n + 1)}>
                    Retry attachment
                  </button>
                  <button
                    onClick={() => {
                      void recover();
                    }}
                  >
                    Recover stale reservation…
                  </button>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mc-setup">
          {p.target && (
            <div className="mc-notice">
              <strong>View detached — not a stop command.</strong>
              <p>
                Terminal retention is up to 30 minutes, not a work timeout.
                Gateway work may outlive the terminal. No indefinite-running
                guarantee.
              </p>
              <button
                onClick={() => {
                  setConnection("connecting");
                  setDetail("");
                  props.update({ detached: false });
                }}
              >
                Reattach retained terminal
              </button>
              <button
                onClick={() => {
                  props.update({ target: null, detached: false });
                }}
              >
                Choose another conversation
              </button>
            </div>
          )}
          {!p.target && (
            <>
              <label>
                Workspace for a new conversation
                <input
                  aria-label={`Workspace for pane ${props.index + 1}`}
                  list={`mc-workspaces-${p.id}`}
                  placeholder="/absolute/host/project/path"
                  value={p.workspace}
                  onChange={(e) => props.update({ workspace: e.target.value })}
                />
              </label>
              <datalist id={`mc-workspaces-${p.id}`}>
                {[...options].map(([path, label]) => (
                  <option key={path} value={path}>
                    {label}
                  </option>
                ))}
              </datalist>
              <p className="mc-start-warning">
                Starting a terminal can evict an older detached view at the
                dashboard’s 16-terminal cap. Account for its active work first;
                terminal retention is not a work guarantee.
              </p>
              <button
                className="mc-primary"
                onClick={() => {
                  try {
                    const target = newTarget(p.workspace);
                    setError("");
                    setConnection("connecting");
                    setDetail("");
                    props.update({
                      target,
                      attempted: false,
                      detached: false,
                      sessionId: undefined,
                      title: undefined,
                      model: undefined,
                    });
                  } catch {
                    setError(
                      "Choose an absolute host workspace path first. Hermes will validate that it exists.",
                    );
                  }
                }}
              >
                Start new conversation
              </button>
              <div className="mc-or">
                or resume (keeps its original workspace)
              </div>
              {p.sessionId && (
                <button
                  onClick={() => {
                    setResumeId(p.sessionId!);
                  }}
                >
                  Use previously selected session
                </button>
              )}
              <label>
                Existing conversation
                <select
                  aria-label={`Existing conversation for pane ${props.index + 1}`}
                  value={
                    props.sessions.some((s) => s.id === resumeId)
                      ? resumeId
                      : ""
                  }
                  onChange={(e) => setResumeId(e.target.value)}
                >
                  <option value="">Select a conversation…</option>
                  {props.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || s.id}
                      {s.is_active ? " (may be active)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Or exact session ID
                <input
                  aria-label={`Session ID for pane ${props.index + 1}`}
                  value={resumeId}
                  onChange={(e) => setResumeId(e.target.value)}
                  placeholder="Existing default-profile session ID"
                />
              </label>
              <div className="mc-actions">
                <button
                  disabled={!resumeId.trim() || opening}
                  onClick={() => {
                    void resume();
                  }}
                >
                  {opening ? "Resolving…" : "Resume conversation"}
                </button>
                <button onClick={props.refreshSessions}>Refresh list</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mc-notice mc-error" role="alert">
          {error}
          <button aria-label="Dismiss pane notice" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

interface SplitterProps {
  orientation: "vertical" | "horizontal";
  value: number;
  change(value: number): void;
}
function Splitter(props: SplitterProps) {
  const vertical = props.orientation === "vertical";
  return (
    <div
      className={`mc-splitter mc-splitter-${props.orientation}`}
      role="separator"
      aria-label={vertical ? "Resize columns" : "Resize rows"}
      aria-orientation={props.orientation}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      style={
        vertical ? { left: props.value + "%" } : { top: props.value + "%" }
      }
      onKeyDown={(e) => {
        const delta =
          e.key === (vertical ? "ArrowRight" : "ArrowDown")
            ? 2
            : e.key === (vertical ? "ArrowLeft" : "ArrowUp")
              ? -2
              : 0;
        if (delta || ["Home", "End"].includes(e.key)) {
          e.preventDefault();
          props.change(
            e.key === "Home"
              ? 20
              : e.key === "End"
                ? 80
                : clamp(props.value + delta),
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const box = e.currentTarget.parentElement!.getBoundingClientRect();
        props.change(
          clamp(
            (vertical
              ? (e.clientX - box.left) / box.width
              : (e.clientY - box.top) / box.height) * 100,
          ),
        );
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}

export function MultiChat() {
  const [layout, setLayout] = React.useState(restore);
  const current = React.useRef(layout);
  current.current = layout;
  const [workspaces, setWorkspaces] = React.useState<WorkspaceData | null>(
    null,
  );
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [notice, setNotice] = React.useState("");
  const [storageWarning, setStorageWarning] = React.useState("");
  const refreshSessions = () => {
    void sdk
      .fetchJSON<{ sessions: SessionRow[] }>(
        "/api/sessions?profile=default&limit=100&offset=0&order=recent",
      )
      .then((data) => setSessions(data.sessions))
      .catch(() =>
        setNotice(
          "Session list unavailable. Check your sign-in. Existing terminals were not restarted.",
        ),
      );
  };
  React.useEffect(() => {
    let cancelled = false;
    void sdk
      .fetchJSON<WorkspaceData>("/api/chat/workspaces?profile=default")
      .then((data) => {
        if (cancelled) return;
        setWorkspaces(data);
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            "Workspace discovery unavailable. Enter an absolute host path; the backend validates it.",
          );
      });
    refreshSessions();
    const persist = () => {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...current.current, savedAt: Date.now() }),
        );
      } catch {
        setStorageWarning(
          "Browser session storage is blocked. Layout cannot survive refresh; close views carefully.",
        );
      }
    };
    const timer = setInterval(persist, 10000);
    window.addEventListener("pagehide", persist);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, []);
  React.useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...layout, savedAt: Date.now() }),
      );
    } catch {
      /* The persistence effect surfaces the limitation. */
    }
  }, [layout]);
  const update = (id: string, patch: Partial<Pane>) =>
    setLayout((l) => ({
      ...l,
      panes: l.panes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const focus = (id: string) =>
    setLayout((l) => ({
      ...l,
      focused: id,
      count: l.panes.findIndex((p) => p.id === id) > 1 ? 4 : l.count,
      maximized: l.maximized && l.maximized !== id ? null : l.maximized,
    }));
  const resume = async (pane: Pane, sessionId: string) => {
    const lineage = await sdk.fetchJSON<{ session_id: string; path: string[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/latest-descendant?profile=default`,
    );
    const already = existingPane(
      current.current.panes,
      lineage.session_id,
      pane.id,
      lineage.path,
    );
    if (already) {
      focus(already.id);
      setNotice(
        "That conversation is already selected. Focused its existing view instead of starting a second writer.",
      );
      return;
    }
    const session = await sdk.fetchJSON<SessionRow>(
      `/api/sessions/${encodeURIComponent(lineage.session_id)}?profile=default`,
    );
    if (
      !window.confirm(
        "Resume this conversation? If it is open in Normal Chat, a CLI, another browser or another device, Hermes may transfer ownership or refuse the attach. Finish or detach that view first. Multi Chat cannot coordinate other clients' browser reservations. Its original workspace will be preserved. Opening a terminal can also evict an older detached view at the 16-terminal cap.",
      )
    )
      return;
    update(pane.id, {
      target: newTarget("", lineage.session_id),
      attempted: false,
      sessionId: lineage.session_id,
      title: session.title || undefined,
      model: session.model,
      workspace:
        session.cwd || "Original workspace (reported by TUI after attach)",
      detached: false,
    });
  };
  const hiddenCount = layout.panes.filter(
    (p, i) =>
      p.target &&
      !p.detached &&
      ((layout.count === 2 && i > 1) ||
        (layout.maximized && layout.maximized !== p.id)),
  ).length;
  return (
    <div
      className="mc-root"
      onKeyDown={(e) => {
        const index = paneHotkey(e);
        if (index !== null) {
          e.preventDefault();
          focus(layout.panes[index].id);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLButtonElement>(
                `[data-pane="${index + 1}"] .mc-pane-focus`,
              )
              ?.focus(),
          );
        }
      }}
    >
      <div className="mc-page-heading">
        <div>
          <h1>Multi Chat</h1>
          <p>Independent Hermes terminals · default profile</p>
        </div>
        <div className="mc-actions">
          <button
            aria-pressed={layout.count === 2}
            onClick={() =>
              setLayout((l) => ({
                ...l,
                count: 2,
                maximized: null,
                focused: l.panes.slice(0, 2).some((p) => p.id === l.focused)
                  ? l.focused
                  : l.panes[0].id,
              }))
            }
          >
            Two panes
          </button>
          <button
            aria-pressed={layout.count === 4}
            onClick={() =>
              setLayout((l) => ({ ...l, count: 4, maximized: null }))
            }
          >
            Four panes
          </button>
          {layout.maximized && (
            <button
              onClick={() => setLayout((l) => ({ ...l, maximized: null }))}
            >
              Restore layout
            </button>
          )}
        </div>
      </div>
      <details className="mc-help">
        <summary>Model selection, keyboard and lifecycle</summary>
        <p>
          Type <code>/model provider:model --session</code> in the intended TUI,
          or use its <code>/model</code> picker. Avoid <code>--global</code>.
          The plugin never writes profile defaults. Input, tools and
          approval/clarification dialogs are the real Hermes TUI.
        </p>
        <p>
          Use Alt+Shift+1–4 to select a pane; Tab reaches toolbar controls. Drag
          splitters or use their arrow keys. Paste through the terminal's native
          browser paste; Copy selection uses a user-gesture fallback on LAN
          HTTP. Browser clipboard restrictions still apply.
        </p>
        <p>
          Close view detaches; it does not stop work. Type <code>/stop</code> to
          interrupt that pane’s current turn (Ctrl+C can clear a draft instead).
          Hosted dashboard mode disables <code>/exit</code>. v0.22.6 retains
          detached terminal processes for up to 30 minutes, with 16 total
          terminals and a 1 MiB replay buffer each; capacity pressure, child
          exit or dashboard restart may end them earlier. Gateway-owned turns
          can outlive a terminal. By default an orphaned session is marked to
          close after a further 300 seconds without a viewer, only once its
          queue is idle; profile settings can change this. Neither layer is an
          indefinite-running guarantee. Restores older than 29 minutes require
          explicit reattachment.
        </p>
        <p>
          Each pane costs a real TUI process and agent session (plus tool
          containers/model quota when used). Distinct conversations editing the
          same project still need separate worktrees. Leaving this page detaches
          its views; it is not a scheduler.
        </p>
      </details>
      {(notice || storageWarning || hiddenCount > 0) && (
        <div className="mc-notice" role="status">
          {notice || storageWarning}
          {hiddenCount > 0 && (
            <span>
              {" "}
              {hiddenCount} hidden terminal(s) remain connected. Layout changes
              do not stop work.
            </span>
          )}
          {notice && <button onClick={() => setNotice("")}>Dismiss</button>}
        </div>
      )}
      <div
        className={`mc-grid mc-count-${layout.count} ${layout.maximized ? "mc-maximized" : ""}`}
        style={{
          gridTemplateColumns: `${layout.columns}fr ${100 - layout.columns}fr`,
          gridTemplateRows:
            layout.count === 4
              ? `${layout.rows}fr ${100 - layout.rows}fr`
              : "1fr",
        }}
      >
        {layout.panes.map((pane, index) => (
          <ChatPane
            key={pane.id}
            pane={pane}
            index={index}
            focused={layout.focused === pane.id}
            maximized={layout.maximized === pane.id}
            hidden={
              layout.maximized
                ? layout.maximized !== pane.id
                : layout.count === 2 && index > 1
            }
            workspaces={workspaces}
            sessions={sessions}
            update={(patch) => update(pane.id, patch)}
            focus={() =>
              setLayout((l) =>
                l.focused === pane.id ? l : { ...l, focused: pane.id },
              )
            }
            maximize={() =>
              setLayout((l) => ({
                ...l,
                maximized: l.maximized === pane.id ? null : pane.id,
                focused: pane.id,
              }))
            }
            resume={(id) => resume(pane, id)}
            refreshSessions={refreshSessions}
            conflict={(id) => {
              if (id) focus(id);
              else
                setNotice(
                  "Another tab owns this conversation. Switch to it, or choose a different session. No automatic takeover was attempted.",
                );
            }}
          />
        ))}
        {!layout.maximized && (
          <>
            <Splitter
              orientation="vertical"
              value={layout.columns}
              change={(columns) => setLayout((l) => ({ ...l, columns }))}
            />
            {layout.count === 4 && (
              <Splitter
                orientation="horizontal"
                value={layout.rows}
                change={(rows) => setLayout((l) => ({ ...l, rows }))}
              />
            )}
          </>
        )}
      </div>
      <p className="mc-footer">
        No prompt replay · no profile-default changes · Close view ≠ stop work
      </p>
    </div>
  );
}
