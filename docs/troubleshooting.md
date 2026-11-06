# Troubleshooting

[Docs](index.md) / Troubleshooting

Start with:

```bash
python3 install.py doctor
```

It reads compatibility/consent only; it does not install, restart or reveal credentials. `--json` adds a machine-readable result containing local paths—redact those before sharing.

## Multi Chat is missing from navigation

1. Confirm this is the **default-profile Web Dashboard**, not Desktop.
2. Run `doctor` and confirm the exact supported build and an installed/enabled plugin.
3. Open **Plugins → Rescan dashboard extensions**, then reload the page.
4. If disabled, preview `python3 install.py enable`, then repeat with `--apply` and rescan.

The manifest must be at `<home>/plugins/multi-chat/dashboard/manifest.json`. Do not copy a nested GitHub source archive into that directory and expect it to be built. Use the prebuilt installer or `npm run package`.

## “Unsupported” or incompatible runtime

Only the [pinned build](compatibility.md) is supported. The installer does not upgrade/downgrade Hermes, switch profiles, change isolation, or offer an unsafe `--force` override.

If Hermes was upgraded after installation, the frontend refuses attachment. Use a compatible plugin release when available. If you must remove files while the installer cannot validate the new build, account for active work first and move only the `multi-chat` directory **outside `plugins/`** using your normal file-management process; then rescan/reload. Do not delete history or edit core files to suppress the guard.

## Hermes source or Python cannot be found

Pass `--hermes-source` for a nonstandard source location. `--python` must point to an **existing Hermes runtime** with the dependencies already installed—not just any system interpreter. The installer will not create an environment or run pip.

Run as the profile owner. A symlinked config/plugin path requires deliberate manual review rather than an automatic installer workaround. If `HERMES_PROFILE` names a non-default profile, return to the default environment before retrying.

## Checksum or archive validation failed

Download the installer, archive and `.sha256` file from the **same v0.2.2 release**. A local checksum must sit beside its archive and name that exact filename. Do not disable verification or edit a checksum to fit an unexpected download.

GitHub may be unavailable or blocked; use the [offline installation path](installation.md#custom-paths-and-an-offline-bundle). Checksums validate integrity, not a separate publisher identity.

## A pane is connected but not ready

A socket connection can precede the TUI's startup. Wait for the **connected** badge **and native TUI `ready`**. A prefilled resumed-session ID/title is not an attachment acknowledgement. Early input blocks the whole attempt to avoid turning a dropped slash prefix into a partial prompt. Wait for startup, use **Retry attachment**, then retype; do not use stale-reservation recovery for this. Confirm the chosen workspace exists on the **server** and the native Hermes TUI works there.

If the initial acknowledgement is lost, the plugin may ask you to choose/resume again instead of retrying creation. Inspect recent sessions before explicitly starting another conversation. Prompts are not automatically replayed.

## “Conversation already open” or a stale reservation

Focus the existing pane. If another tab is alive, finish/detach/close its view before transferring the conversation. Do not use recovery to steal ownership from a slow or suspended tab.

After a confirmed browser crash, **Recover stale reservation…** is available with an interruption warning. Browser storage must be allowed. Clearing ownership storage while another Multi Chat tab is alive defeats its safety boundary.

Other browsers/devices and normal Chat/CLI do not share this browser reservation. See [ownership scope](compatibility.md#browser-ownership-boundary).

## Reducing the pane count did not stop work

**Visible panes** controls layout slots, not execution. Hidden connected views are retained and counted in the notice. Increase the count, or use an existing pane's Alt+Shift+1–9 shortcut, to reveal it. Use `/stop` inside the intended TUI if you want to interrupt its turn. The 16-slot selector does not increase the shared 16-PTY capacity.

## Refresh cannot find the retained terminal

It may have exited, expired, been evicted or belonged to an old server process. The plugin refuses ordinary automatic recreation. Select a durable session explicitly to resume; do not assume a retained PTY lives indefinitely.

If an outage also prevents the read-only HTTP identity check, attachment fails closed and may need **Retry attachment** after connectivity returns. Automatic PTY-socket reconnect is verified while that identity service remains available; automatic recovery from every whole-network outage is not guaranteed.

This refusal is different from the [narrow non-atomic attachment race](compatibility.md#known-attachment-race), which remains documented.

## Update did not replace the API behavior

Rescan and browser reload update the manifest/assets, but Python already imported by the dashboard does not hot-reload just because files changed. Plan a dashboard restart **only after accounting for active work**, using your own service controls. Never use a gateway restart or plugin removal as a stop-work command.

## Copy/paste or mobile input behaves differently

Plain LAN HTTP does not grant clipboard-read privileges. Try the terminal/browser's normal paste or copy menu. Secure clipboard writes are used only when available, with a user-gesture fallback otherwise. Mobile IME and OS permission behavior have not been verified on real devices.

## Reporting a problem safely

[Open a bug report](https://github.com/BColsey/hermes-multi-chat/issues/new/choose) with:

- Plugin version, Hermes version/commit, browser/version and OS.
- Whether it is a default-profile dashboard, and HTTP or HTTPS.
- Minimal steps using **disposable** sessions/workspaces, expected versus actual behavior.
- A redacted error or screenshot if needed.

**Never post** passwords, API keys, cookies, WebSocket tickets, `.dev/`, `state.db`, private transcripts, full environment/config dumps or unredacted logs. Redact workspace paths, session IDs, account status and private hostnames. Sensitive security issues belong in [private vulnerability reporting](../.github/SECURITY.md), not a public issue.

[Installation](installation.md) · [Usage](usage.md) · [Compatibility](compatibility.md)
