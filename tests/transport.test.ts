import { describe, expect, it, vi, afterEach } from "vitest";
import { PtyConnection, parseSessionInfo } from "../src/transport";
import { newTarget } from "../src/state";
class Socket {
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
function setup() {
  const sockets: { path: string; socket: Socket }[] = [],
    params: object[] = [],
    states: string[] = [],
    out: unknown[] = [];
  const conn = new PtyConnection(newTarget("/tmp/a"), {
    buildWsUrl: async (path, p) => {
      params.push({ ...p });
      return path;
    },
    socket: (path) => {
      const socket = new Socket();
      sockets.push({ path, socket });
      return socket;
    },
    output: (data) => out.push(data),
    state: (state) => states.push(state),
    info: async () => {},
    size: () => ({ cols: 80, rows: 24 }),
  });
  return { conn, sockets, params, states, out };
}
describe("authenticated terminal lifecycle", () => {
  it("subscribes before spawning, uses the SDK for both sockets, and forwards raw input only while open", async () => {
    const x = setup();
    x.conn.start();
    await tick();
    expect(x.sockets.map((s) => s.path)).toEqual(["/api/events"]);
    expect(x.conn.send("not buffered")).toBe(false);
    x.sockets[0].socket.open();
    await tick();
    x.sockets[1].socket.open();
    expect(x.conn.send("/help\r")).toBe(true);
    expect(x.sockets[1].socket.sent).toEqual(["\x1b[RESIZE:80;24]", "/help\r"]);
    x.conn.dispose();
  });
  it("reuses attachment and channel and never replays input on reconnect", async () => {
    vi.useFakeTimers();
    const x = setup();
    x.conn.start();
    await tick();
    x.sockets[0].socket.open();
    await tick();
    x.sockets[1].socket.open();
    x.conn.send("typed once");
    x.sockets[1].socket.drop();
    expect(x.conn.send("offline input")).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await tick();
    x.sockets[2].socket.open();
    expect(x.params[1]).toEqual(x.params[2]);
    expect(x.sockets[2].socket.sent).toEqual(["\x1b[RESIZE:80;24]"]);
    x.conn.dispose();
  });
  it.each([4401, 4403, 4409, 4410])(
    "does not auto-restart a rejected/ended PTY (%i)",
    async (code) => {
      vi.useFakeTimers();
      const x = setup();
      x.conn.start();
      await tick();
      x.sockets[0].socket.open();
      await tick();
      x.sockets[1].socket.open();
      x.sockets[1].socket.drop(code);
      await vi.advanceTimersByTimeAsync(30000);
      expect(x.sockets.filter((s) => s.path === "/api/pty")).toHaveLength(1);
      x.conn.dispose();
    },
  );
  it("drops a late ticket result after disposal without opening a terminal", async () => {
    let finish!: (s: string) => void;
    const socket = vi.fn();
    const conn = new PtyConnection(newTarget("/tmp/a"), {
      buildWsUrl: () =>
        new Promise((r) => {
          finish = r;
        }),
      socket,
      output: () => {},
      state: () => {},
      info: async () => {},
      size: () => ({ cols: 80, rows: 24 }),
    });
    conn.start();
    conn.dispose();
    finish("/api/events");
    await tick();
    expect(socket).not.toHaveBeenCalled();
  });
  it("checks retention before each PTY dial and accepts its session control without injecting input", async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const params: object[] = [];
    const info = vi.fn(async () => {});
    const c = new PtyConnection(newTarget("/tmp/a"), {
      ptyParams: async () => ({
        channel: "observed-channel",
        attach: "opaque-observed-key",
      }),
      buildWsUrl: async (path, p) => {
        params.push(p);
        return path;
      },
      socket: () => {
        const s = new Socket();
        sockets.push(s);
        return s;
      },
      output: () => {},
      state: () => {},
      info,
      size: () => ({ cols: 80, rows: 24 }),
    });
    c.start();
    await tick();
    sockets[0].open();
    await tick();
    sockets[1].open();
    sockets[1].drop();
    await vi.advanceTimersByTimeAsync(600);
    await tick();
    expect(sockets).toHaveLength(3);
    expect(params[1]).toEqual({
      channel: "observed-channel",
      attach: "opaque-observed-key",
    });
    expect(params[1]).toEqual(params[2]);
    sockets[2].open();
    sockets[2].onmessage?.({
      data: JSON.stringify({ type: "resume", id: "session-created-by-tui" }),
    });
    await tick();
    expect(info).toHaveBeenCalledWith({ sessionId: "session-created-by-tui" });
    await vi.advanceTimersByTimeAsync(2500);
    expect(sockets).toHaveLength(3);
    expect(sockets[2].sent).toEqual(["\x1b[RESIZE:80;24]"]);
    c.dispose();
  });
  it("parses only session metadata, never stores transcript or echoed prompts", () => {
    expect(
      parseSessionInfo(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "event",
          params: {
            type: "session.info",
            session_id: "runtime",
            payload: {
              stored_session_id: "stored",
              cwd: "/tmp/a",
              title: "Test",
              model: "m",
              system_prompt: "private",
            },
          },
        }),
      ),
    ).toEqual({
      sessionId: "stored",
      workspace: "/tmp/a",
      title: "Test",
      model: "m",
    });
    expect(
      parseSessionInfo(
        '{"method":"event","params":{"type":"message.delta","payload":{"text":"private"}}}',
      ),
    ).toBeNull();
  });
});
