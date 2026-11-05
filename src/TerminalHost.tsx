import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { React, sdk } from "./sdk";
import { Ownership } from "./ownership";
import { PaneAPI, type Inspection } from "./pane-api";
import { randomId, paneHotkey, type Pane } from "./state";
import {
  PtyConnection,
  type ConnectionState,
  type SessionMetadata,
  type SocketLike,
} from "./transport";

let ownership: Ownership | undefined;
export function browserOwnership(): Ownership {
  return (ownership ??= new Ownership(indexedDB, localStorage, randomId()));
}
const liveConnections = new Set<PtyConnection>();
window.addEventListener("pagehide", () => {
  for (const connection of liveConnections) connection.dispose();
  ownership?.releaseDocument();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
let runtimeCheck: Promise<void> | undefined;
function checkRuntime(): Promise<void> {
  return (runtimeCheck ??= sdk
    .fetchJSON<{ version: string; commit: string }>("/api/health")
    .then((health) => {
      if (
        window.__HERMES_DASHBOARD_PROFILE__ !== "default" ||
        health.version !== "0.22.6" ||
        health.commit !== "f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab"
      )
        throw new Error("Unsupported dashboard build or launch profile.");
    }));
}

export interface TerminalControls {
  focus(): void;
  copy(): Promise<boolean>;
}
interface Props {
  pane: Pane;
  retry: number;
  onAttempt(): void;
  onState(state: ConnectionState, detail: string): void;
  onMetadata(info: SessionMetadata): void;
  onConflict(paneId: string | null): void;
  controls: { current: TerminalControls | null };
}
export function TerminalHost(props: Props) {
  const container = React.useRef<HTMLDivElement>(null);
  const callbacks = React.useRef(props);
  callbacks.current = props;
  const target = props.pane.target!;
  React.useEffect(() => {
    let cancelled = false;
    let verified = false;
    let connected = false;
    let firstInfo = true;
    let observedLiving = false;
    let metadataId = "";
    let connection: PtyConnection | undefined;
    let owner: Ownership | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let syncFlight: Promise<void> | undefined;
    let inputFlight = Promise.resolve();
    const setVerified = (value: boolean) => {
      verified = value;
      if (!cancelled && connected && !connection?.isStopped)
        callbacks.current.onState(
          value ? "connected" : "connecting",
          value
            ? "Connected"
            : "Verifying terminal identity — input is not ready yet.",
        );
    };
    const claimed = new Set<string>();
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 3000,
      screenReaderMode: true,
      allowProposedApi: true,
      theme: {
        background: "#0b1518",
        foreground: "#e1edef",
        cursor: "#4fd1c5",
        selectionBackground: "#315356",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(container.current!);
    term.textarea?.setAttribute("aria-label", "Hermes terminal input");
    const resize = () => {
      if (
        cancelled ||
        !container.current ||
        container.current.clientWidth < 80 ||
        container.current.clientHeight < 80
      )
        return;
      fit.fit();
      connection?.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    const fitted = term.onResize(() => connection?.resize());
    const copy = async () => {
      const text = term.getSelection();
      if (!text) return false;
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          /* User-gesture fallback below. */
        }
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      term.focus();
      return copied;
    };
    callbacks.current.controls.current = { focus: () => term.focus(), copy };
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        term.hasSelection()
      ) {
        void copy();
        return false;
      }
      return paneHotkey(event) === null;
    });
    resize();
    void document.fonts.ready.then(() => {
      if (!cancelled) resize();
    });
    const api = new PaneAPI(
      target,
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          return await sdk.fetchJSON<Inspection>(
            `/api/plugins/multi-chat/pane?profile=default&channel=${encodeURIComponent(target.channel)}&attachment=${target.attach}`,
            { signal: controller.signal },
          );
        } finally {
          clearTimeout(timeout);
        }
      },
      !props.pane.attempted,
      () => callbacks.current.onAttempt(),
    );
    const acceptIdentity = async (
      sessionId: string,
      refreshDetails: boolean,
    ) => {
      if (cancelled) return;
      if (metadataId === sessionId && !refreshDetails) {
        setVerified(true);
        return;
      }
      if (
        firstInfo &&
        props.pane.sessionId &&
        sessionId !== props.pane.sessionId
      ) {
        const lineage = await sdk.fetchJSON<{ path: string[] }>(
          `/api/sessions/${encodeURIComponent(props.pane.sessionId)}/latest-descendant?profile=default`,
        );
        if (!lineage.path.includes(sessionId)) {
          connection?.block(
            "The retained terminal does not match the saved conversation. No input was sent. Close this view and explicitly select a conversation.",
          );
          return;
        }
      }
      const key = "session:" + sessionId;
      const conflict = await owner!.claim([key], props.pane.id);
      if (cancelled) {
        if (!conflict) await owner!.release([key], props.pane.id);
        return;
      }
      if (conflict) {
        setVerified(false);
        connection?.block(
          "This conversation is already selected in another pane or tab. This view will not send input.",
        );
        callbacks.current.onConflict(
          conflict.owner === owner!.owner ? conflict.pane : null,
        );
        return;
      }
      claimed.add(key);
      const row = await sdk.fetchJSON<{
        cwd?: string;
        title?: string;
        model?: string;
      }>(`/api/sessions/${encodeURIComponent(sessionId)}?profile=default`);
      if (cancelled) return;
      for (const old of [...claimed])
        if (old.startsWith("session:") && old !== key) {
          await owner!.release([old], props.pane.id);
          claimed.delete(old);
        }
      firstInfo = false;
      metadataId = sessionId;
      setVerified(true);
      callbacks.current.onMetadata({
        sessionId,
        workspace: row.cwd || props.pane.workspace,
        title: row.title || undefined,
        model: row.model,
      });
    };
    const synchronize = (refreshDetails = false): Promise<void> => {
      if (cancelled || connection?.isStopped) return Promise.resolve();
      if (syncFlight) return syncFlight;
      syncFlight = (async () => {
        const state = await api.read();
        if (cancelled || connection?.isStopped) return;
        if (!state.retained) {
          setVerified(false);
          if (observedLiving)
            connection?.block(
              "The retained terminal is gone. No replacement was spawned. Close this view and explicitly resume its saved conversation.",
            );
          return;
        }
        observedLiving = true;
        if (state.session_id)
          await acceptIdentity(state.session_id, refreshDetails);
        else setVerified(false);
      })()
        .catch(() => {
          setVerified(false);
          if (!cancelled)
            connection?.block(
              "Read-only terminal identity verification failed. No input will be sent. Check plugin compatibility and sign-in, then reattach.",
            );
        })
        .finally(() => {
          syncFlight = undefined;
        });
      return syncFlight;
    };
    const input = term.onData((data) => {
      // Protocol replies are not user prompts and must be allowed during TUI boot.
      if (
        /^(?:\x1b\[[?>0-9;]*c|\x1b\[[IO]|\x1b\](?:10|11);rgb:[0-9a-f/]+\x1b\\)$/i.test(
          data,
        )
      ) {
        connection?.send(data);
        return;
      }
      // Do not drop only the prefix of a draft and admit its remaining bytes
      // when verification finishes mid-typing. Reject the whole attempt instead.
      if (
        (!verified || !connected || !navigator.onLine) &&
        connection &&
        !connection.isStopped
      ) {
        connection.block(
          "Input arrived before session identity was verified. Nothing was submitted. Wait for startup, then Retry attachment and retype.",
        );
        return;
      }
      if (!verified || !connection || connection.isStopped) return;
      const epoch = connection.epoch;
      const sessionAtInput = metadataId;
      // Recheck the channel marker before forwarding human input: /new and
      // /resume are handled by the real TUI, not a second composer/parser.
      // Work admitted against an old socket epoch is discarded, never replayed.
      inputFlight = inputFlight
        .then(async () => {
          await synchronize();
          if (cancelled || !connection || connection.isStopped) return;
          if (
            !verified ||
            !connected ||
            connection.epoch !== epoch ||
            metadataId !== sessionAtInput
          ) {
            connection.block(
              "Terminal identity or connection changed while checking input. Nothing was replayed. Retry attachment and retype explicitly.",
            );
            return;
          }
          if (!connection.send(data))
            connection.block(
              "Terminal disconnected before input could be sent. Nothing was replayed. Retry attachment and retype explicitly.",
            );
        })
        .catch(() => {
          setVerified(false);
        });
    });
    const start = async () => {
      try {
        await checkRuntime();
        if (cancelled) return;
        owner = browserOwnership();
        const selected = props.pane.sessionId || target.resume;
        const keys = [
          "attach:" + target.attach,
          ...(selected ? ["session:" + selected] : []),
        ];
        const conflict = await owner.claim(keys, props.pane.id);
        if (cancelled) {
          if (!conflict) await owner.release(keys, props.pane.id);
          return;
        }
        if (conflict) {
          callbacks.current.onState(
            "conflict",
            "Already open in another pane or browser tab. No terminal attached. Focus that view, or start a different conversation.",
          );
          callbacks.current.onConflict(
            conflict.owner === owner.owner ? conflict.pane : null,
          );
          return;
        }
        for (const key of keys) claimed.add(key);
        connection = new PtyConnection(target, {
          ptyParams: () => api.params(),
          buildWsUrl: (path, params) => sdk.buildWsUrl(path, params),
          socket: (url) => new WebSocket(url) as unknown as SocketLike,
          size: () => ({ cols: term.cols, rows: term.rows }),
          output: (data) => {
            term.write(data);
          },
          state: (state, detail) => {
            connected = state === "connected";
            if (!connected) verified = false;
            if (!cancelled)
              callbacks.current.onState(
                connected && !verified ? "connecting" : state,
                connected && !verified
                  ? "Verifying terminal identity — input is not ready yet."
                  : detail,
              );
          },
          info: async () => {
            await synchronize(true);
          },
          inventoryChanged: () => {
            // Live keystrokes already await this check; unrelated session-list
            // updates must not masquerade as an unverified initial attachment.
            void synchronize(true);
          },
        });
        liveConnections.add(connection);
        connection.start();
        poll = setInterval(() => {
          void synchronize();
        }, 1000);
      } catch {
        if (!cancelled)
          callbacks.current.onState(
            "error",
            "Multi Chat requires the verified default-profile Hermes 0.22.6 build, its in-process read-only plugin API, IndexedDB and local storage. No terminal input is enabled.",
          );
      }
    };
    void start();
    return () => {
      cancelled = true;
      verified = false;
      if (poll) clearInterval(poll);
      connection?.dispose();
      if (connection) liveConnections.delete(connection);
      observer.disconnect();
      fitted.dispose();
      input.dispose();
      term.dispose();
      callbacks.current.controls.current = null;
      if (owner)
        void owner.release([...claimed], props.pane.id).catch(() => {
          /* Failed releases stay reserved. */
        });
    };
    // Pane metadata, focus and layout are intentionally NOT terminal identities.
  }, [target.attach, props.pane.detached, props.retry]);
  return <div className="mc-terminal" ref={container} />;
}
