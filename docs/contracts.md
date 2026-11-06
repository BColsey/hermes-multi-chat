# Integration contracts

[Docs](index.md) / Reference

This is a Web Dashboard plugin, following the [official dashboard extension documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard). It is not a Desktop `@hermes/plugin-sdk` plugin.

## Inspected installed code

Paths below are relative to the [Hermes source tree](https://github.com/NousResearch/hermes-agent/tree/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab), inspected at v0.22.6 / `f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab`:

- `web/src/plugins/registry.ts`, `sdk.d.ts`: SDK 1.1.0 exposes host React, `fetchJSON`, `authedFetch`, `buildWsUrl`; it does not export a reusable `ChatPage`/xterm host.
- `web/src/pages/ChatPage.tsx`, `web/src/lib/api.ts`: real TUI terminal, authenticated ticket/token helper, event feed and resize protocol.
- `web/src/lib/pty-attach-token.ts`: stock sessionStorage/Web Locks identity fallback is insufficient for cloned tabs without Web Locks.
- `web/src/lib/chat-workspaces.ts`: stock fresh-workspace preference is profile-wide; this plugin never uses it as pane state.
- `hermes_cli/web_routers/chat_ws.py`, `web_server_chat.py`, `pty_session.py`: PTY spawning/retention, channel marker files, opaque registry keys, resume canonicalization and close codes.
- `hermes_cli/web_server_dashboard.py`, `web_routers/dashboard_ui.py`: manifest discovery, explicit plugin consent, auth/runtime gates, hot mount, disable and static assets.
- `ui-tui/src/app/useSessionLifecycle.ts`, `app/slash/commands/core.ts`, `session.ts`, `ops.ts`: marker updates, native confirmation, session model selection, `/stop`, and hosted `/exit` refusal.
- `gateway/session_viewer_close.py`: gateway orphan cleanup is distinct from terminal retention and does not cancel busy work merely because its viewer vanishes.

The plugin makes no changes to Hermes core files. The source/version guard is necessary because the read-only adapter uses private registry APIs, not a promised cross-version extension contract.

## Frontend boundary

`dashboard/manifest.json` adds `/multi-chat`, not an override of `/chat`. The bundle uses `window.__HERMES_PLUGIN_SDK__.React` and `window.__HERMES_PLUGINS__.register("multi-chat", ...)`. xterm/fit/Unicode11 are bundled locally; no runtime asset comes from a CDN. Terminal CSS is scoped to `.mc-root`.

The visible-pane selector accepts 1–16 slots and grows the saved pane array only when needed. Reducing the count never deletes a pane or unmounts its terminal. Schema-1 two/four-pane state migrates to schema 2 while preserving all IDs and targets, including hidden views. Grid track counts adapt without changing backend capacity.

Each pane owns random channel and attachment identifiers. Layout/focus only affect CSS/grid state; keyed terminal components retain their DOM and transport. No nested Chat pages, shared stock workspace preference, second composer, transcript renderer, agent executor or model API is implemented.

All WebSocket URLs, including reconnects, are obtained through the SDK's `buildWsUrl`. Passwords/cookies/tickets are neither read nor copied by the plugin. JSON calls use `fetchJSON` with explicit default-profile scope. The raw `/api/pty` protocol is forwarded unchanged, including binary output and `ESC[RESIZE:<cols>;<rows>]` controls. Only live human input is sent; there is no reconnect prompt queue or stored draft. The connected badge is published only after the socket and retained identity are verified. Live keystrokes await identity revalidation without treating unrelated session-list updates as a new attachment; they are sent only on the same live socket epoch and session. A disconnect or identity change discards pending input and requires explicit retyping. If human input arrives before identity verification, the view blocks the whole attempt instead of dropping a prefix and admitting its remaining bytes after verification; retry and retyping are explicit.

## Project-directory selection

The shared folder browser uses SDK `fetchJSON` for `GET /api/fs/list?profile=default&path=…`, the pinned host's existing authenticated directory-listing endpoint. It requests names/types/paths only, never file contents or filesystem writes, and preserves the host's managed-read boundary and sensitive-path filtering. Only entries marked as directories become project choices; no recursive scan or shell command is used.

The optional `projectsDirectory` path is kept in schema-2 tab state, not Hermes configuration. Invalid optional preferences are discarded without losing pane identities. Directory requests have epochs: late results cannot replace a newer selection or reset. The path is saved only after successful listing. Changing the source list never changes a pane's selected workspace/target or terminal key.

## Why a read-only backend adapter exists

In this build, the TUI does not consistently publish `session.info` at creation or after native `/new`/`/resume`. An explicit `resume` query also participates in the retained PTY's registry key, and canonicalization can follow compression descendants. Guessing the current ID from timing, terminal prose, shared preferences or a list of recent sessions is unsafe. Blindly reconnecting a lost attachment can spawn a new terminal.

`dashboard/plugin_api.py` adds exactly one authenticated, read-only observation endpoint:

```text
GET /api/plugins/multi-chat/pane?profile=default&channel=mc-<32 hex>&attachment=<32 hex>
```

It validates both IDs, checks the launch and request scope are the default home, and runs only in the actual dashboard process. It matches that channel's marker to an alive retained PTY owned by the attachment prefix. The response contains retained/not-retained, the current marker's durable session ID, and that PTY's **actual opaque registry attachment key**. It returns no transcript, cookie, ticket, password, prompt or model credential. It never creates/kills a process, attaches a socket, changes a setting or writes input.

For reuse, the frontend gives the observed opaque key to the ordinary `/api/pty` endpoint using the normal SDK-authenticated URL. It omits a new `resume`/`profile` suffix on reuse so Hermes does not recanonicalize/change the registry key. This is valid only because the adapter verifies that the running dashboard itself serves the default home. Fresh/explicit resume creation still passes `profile=default`, and fresh chats always pass `cwd`.

A single explicit new/resume intent permits **one** creation attempt. Refresh and automatic reconnect must observe a live retained PTY first. There is a conservative trade-off: losing an initial acknowledgement can require an explicit retry via session selection, rather than automatic recreation. This avoids duplicate work.

Retention observation and the subsequent `/api/pty` upgrade are not atomic. Hermes 0.22.6 has no attach-only flag: if a child exits in that narrow interval (especially while the old socket is already lost), the native endpoint can create an idle replacement before the plugin detects the mismatch. No prompt is replayed. An absolute no-respawn guarantee for that race requires an additive core `attach_only` capability; this plugin does not add one. Normal retention loss/refresh refusal is covered by an actual killed-child browser test. New/resume UI warns that native capacity admission may evict an older detached terminal.

The adapter needs existing FastAPI only. The discovered `in_process` plugin setting is retained. It is intentionally not a second terminal transport, auth provider, background service or execution API. Private registry/marker integration is gated to the exact verified build by the frontend; future Hermes releases require revalidation.

## Browser ownership

`src/ownership.ts` uses atomic IndexedDB transactions to claim attachment and conversation keys. Local storage holds document release proofs written synchronously on `pagehide`, allowing refresh even if unload interrupts IndexedDB cleanup. It does not steal a reservation based on time: background throttling/freezing must not cause a takeover.

A second page whose sessionStorage is a clone cannot claim the same live reservation. Collisions either focus the existing pane or explain the tab conflict. Human input checks the backend channel identity before forwarding, and drops work tied to a closed/replaced socket epoch. Native TUI session changes therefore do not silently open another writing path to a conversation already reserved in this browser.

A crash can leave a stale reservation. Recovery is explicit and warns about takeover/interruption. Storage denial fails closed. Independent browser profiles/devices and normal Chat/CLI do not share these reservations; explicit resume warns about them and the backend remains the execution authority.

## Limits and preserved gates

- Hosted TUI permissions, approval/clarification UI, slash dispatch, streaming, provider/tool behavior and global-setting capabilities are unchanged. The plugin never grants approval or elevates tool permissions.
- Auth, manifest consent and ticket single-use semantics remain the dashboard's existing gates.
- PTY retention is 30 minutes / 16 terminals / 1 MiB per terminal, with earlier detached eviction under capacity pressure. Gateway work can outlive the terminal; see [usage](usage.md#closing-a-view-is-not-stopping-work).
- This release does not claim general future-version compatibility, plugin-host isolation support, automatic stale-lock stealing, a background-work scheduler, full mobile support or model-backed verification.

Return to [documentation](index.md) or [development checks](development.md).
