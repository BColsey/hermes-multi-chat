import { connectionParams, type Target } from "./state";
export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "conflict"
  | "error";
export interface SessionMetadata {
  sessionId?: string;
  workspace?: string;
  title?: string;
  model?: string;
}
export interface SocketLike {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}
interface Dependencies {
  ptyParams?(): Promise<Record<string, string>>;
  inventoryChanged?(): void;
  buildWsUrl(path: string, params: Record<string, string>): Promise<string>;
  socket(url: string): SocketLike;
  output(data: string | Uint8Array): void;
  state(value: ConnectionState, detail: string): void;
  info(value: SessionMetadata): Promise<void>;
  size(): { cols: number; rows: number };
}
export function parseSessionInfo(text: string): SessionMetadata | null {
  try {
    const frame = JSON.parse(text);
    const event = frame.method === "event" ? frame.params : null;
    if (
      event?.type !== "session.info" ||
      !event.payload ||
      typeof event.payload !== "object"
    )
      return null;
    const p = event.payload;
    const result: SessionMetadata = {};
    if (typeof p.stored_session_id === "string" && p.stored_session_id)
      result.sessionId = p.stored_session_id;
    else if (typeof event.session_id === "string" && event.session_id)
      result.sessionId = event.session_id;
    if (typeof p.cwd === "string" && p.cwd) result.workspace = p.cwd;
    if (typeof p.title === "string" && p.title) result.title = p.title;
    if (typeof p.model === "string" && p.model) result.model = p.model;
    return result;
  } catch {
    return null;
  }
}
const closeDetail = (code: number) =>
  code === 4410
    ? "Session ended. No automatic restart. Start or resume explicitly."
    : code === 4409
      ? "This terminal was attached elsewhere. Reconnect stopped to avoid a takeover loop."
      : "Authentication or server policy rejected the connection. Sign in again or check the dashboard.";
/** No input buffer, prompt injection, RPC agent or auth implementation. */
export class PtyConnection {
  private stopped = false;
  private pty: SocketLike | null = null;
  private feed: SocketLike | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private ptyAttempts = 0;
  private feedAttempts = 0;
  private metadata = Promise.resolve();
  private socketEpoch = 0;
  get epoch(): number {
    return this.socketEpoch;
  }
  get isStopped(): boolean {
    return this.stopped;
  }
  constructor(
    private target: Target,
    private d: Dependencies,
  ) {}
  start(): void {
    this.d.state("connecting", "Connecting authenticated terminal…");
    void this.connectFeed(true);
  }
  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(timer);
  }
  private async url(
    path: string,
    params = connectionParams(this.target),
  ): Promise<string> {
    let timer!: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        this.d.buildWsUrl(path, params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("ticket timeout")), 10000);
          this.timers.add(timer);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.timers.delete(timer);
    }
  }
  private async connectFeed(initial: boolean): Promise<void> {
    try {
      const url = await this.url("/api/events");
      if (this.stopped) return;
      const feed = this.d.socket(url);
      this.feed = feed;
      let opened = false;
      this.later(() => {
        if (feed.readyState === 0) feed.close();
      }, 10000);
      feed.onopen = () => {
        opened = true;
        if (initial && !this.stopped) void this.connectPty();
      };
      feed.onmessage = (e) => {
        if (this.stopped || typeof e.data !== "string") return;
        const info = parseSessionInfo(e.data);
        if (info) this.acceptInfo(info);
        try {
          if (JSON.parse(e.data).params?.type === "sessions.changed")
            this.d.inventoryChanged?.();
        } catch {
          /* Not an inventory event. */
        }
      };
      feed.onerror = () => feed.close();
      feed.onclose = (e) => {
        if (this.stopped) return;
        if ([4401, 4403, 4404].includes(e.code)) {
          this.block(closeDetail(e.code));
          return;
        }
        if (++this.feedAttempts > 5) {
          this.block(
            "Session metadata disconnected. Reattach explicitly; no input was queued.",
          );
          return;
        }
        this.later(
          () => {
            void this.connectFeed(initial && !opened);
          },
          Math.min(500 * 2 ** (this.feedAttempts - 1), 8000),
        );
      };
    } catch {
      if (!this.stopped)
        this.block("Could not authenticate the event feed. Reattach to retry.");
    }
  }
  private async connectPty(): Promise<void> {
    try {
      const params = this.d.ptyParams
        ? await this.d.ptyParams()
        : connectionParams(this.target);
      if (this.stopped) return;
      const url = await this.url("/api/pty", params);
      if (this.stopped) return;
      const ws = this.d.socket(url);
      this.pty = ws;
      this.socketEpoch++;
      ws.binaryType = "arraybuffer";
      this.later(() => {
        if (ws.readyState === 0) ws.close();
      }, 10000);
      ws.onopen = () => {
        if (this.stopped) {
          ws.close();
          return;
        }
        this.d.state("connected", "Connected");
        this.resize();
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => this.resize(), 20000);
      };
      ws.onmessage = (e) => {
        if (this.stopped) return;
        if (typeof e.data === "string") {
          try {
            const c = JSON.parse(e.data);
            if (c.type === "resume" && typeof c.id === "string" && c.id) {
              this.acceptInfo({ sessionId: c.id });
              return;
            }
          } catch {
            /* Text failures from the backend are displayed by the terminal. */
          }
          this.d.output(e.data);
        } else this.d.output(new Uint8Array(e.data));
      };
      ws.onerror = () => ws.close();
      ws.onclose = (e) => {
        this.socketEpoch++;
        if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.stopped) return;
        if ([4401, 4403, 4404, 4409, 4410].includes(e.code)) {
          this.d.state(
            e.code === 4410 ? "ended" : e.code === 4409 ? "conflict" : "error",
            closeDetail(e.code),
          );
          this.dispose();
          return;
        }
        if (++this.ptyAttempts > 5) {
          this.block(
            "Reconnect budget exhausted. Reattach explicitly. Offline input was discarded.",
          );
          return;
        }
        this.d.state(
          "reconnecting",
          "Disconnected — input is not queued. Reattaching the same terminal…",
        );
        this.later(
          () => {
            void this.connectPty();
          },
          Math.min(500 * 2 ** (this.ptyAttempts - 1), 8000),
        );
      };
    } catch {
      if (!this.stopped)
        this.block(
          "No verified retained terminal, or authentication failed. No replacement was spawned. Close this view and explicitly resume the saved conversation, or start a new one.",
        );
    }
  }
  private acceptInfo(info: SessionMetadata): void {
    this.metadata = this.metadata
      .then(() => (this.stopped ? undefined : this.d.info(info)))
      .catch(() =>
        this.block(
          "Session ownership could not be verified. Terminal input disabled.",
        ),
      );
  }
  send(data: string): boolean {
    if (this.stopped || this.pty?.readyState !== 1) return false;
    this.pty.send(data);
    return true;
  }
  resize(): void {
    const { cols, rows } = this.d.size();
    this.send(`\x1b[RESIZE:${cols};${rows}]`);
  }
  block(detail: string): void {
    this.d.state("conflict", detail);
    this.dispose();
  }
  dispose(): void {
    this.socketEpoch++;
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of [this.pty, this.feed]) {
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    }
  }
}
