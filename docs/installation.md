# Install and manage Multi Chat

[Docs](index.md) / Installation

Install the prebuilt preview without compiling JavaScript, copying credentials or editing YAML by hand. Every command **previews by default**. Only `--apply` writes files/settings.

## Before you start

- Run on the **Hermes server**, as the OS user who owns its default profile. Do not use `sudo` to install into someone else's home.
- Have Python **3.11+**, network access to GitHub and a working Hermes Web Dashboard.
- Use Hermes **0.22.6**, commit **`f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab`**, default profile, with existing `plugins.isolation: in_process`. The installer checks these requirements and will not change isolation or upgrade Hermes for you.
- Read the [limitations](compatibility.md), particularly retention and the non-atomic attachment edge case.

The usual target is `~/.hermes/plugins/multi-chat/dashboard/`. An explicit `HERMES_HOME` can select a custom **default** home; named profiles are refused. Native Windows is unsupported because the real dashboard TUI needs a POSIX PTY; use the Hermes server on Linux, macOS or WSL.

## Install the preview

### 1. Download the installer

```bash
curl --fail --location --output install.py \
  https://github.com/BColsey/hermes-multi-chat/releases/download/v0.1.0/install.py
```

This saves a file; it does not pipe remote code into a shell. Inspect it before running it if your policy requires that. The installer is Python standard library only and uses Hermes's **already installed** runtime to read/write its configuration.

### 2. Preview, then apply

```bash
python3 install.py doctor
python3 install.py install
python3 install.py install --apply
```

`install` downloads the **pinned v0.1.0** archive and its checksum over HTTPS, verifies SHA-256 and validates archive paths/files before installation. It does not chase an unpinned “latest” release. The preview checks compatibility and the destination but changes no profile files or settings.

Applying installs the bundled IIFE/CSS and read-only API, then enables only `multi-chat`. Other plugins, authentication, model defaults, tool permissions, session history and service limits remain unchanged. No service is started/restarted. There is no pip/npm installation into Hermes.

> **Trust boundary:** archive checksums catch corruption and mismatches; both checksum and artifact come from the same GitHub release. They are not independent publisher signatures. The installer itself is trusted code you choose to run. `install.py.sha256` and `SHA256SUMS` are available with the release for a manual audit.

### 3. Discover the navigation entry

In the authenticated default Hermes dashboard:

1. Open **Plugins**.
2. Click **Rescan dashboard extensions** in the page header.
3. Reload the browser page.
4. Open **Multi Chat** and start disposable conversations for a smoke test.

You should see two empty panes. Choose an absolute host project directory in each, click **Start new conversation**, and wait for the native TUI's `ready` status and for “Waiting for session identity…” to become a session ID. Check that normal **Chat** still works.

The inspected Hermes build can hot-mount a newly installed plugin API on its first request. Initial installation does not require a dashboard restart. If it fails, use [troubleshooting](troubleshooting.md)—do not weaken authentication or patch core files.

## Custom paths and an offline bundle

The installer normally locates source at `<home>/hermes-agent` and uses Hermes PM's recorded Python environment without provisioning anything. Override paths only when needed:

```bash
python3 install.py doctor --hermes-source "$HOME/src/hermes-agent"
```

`--home` selects a custom default profile; `--python` selects an existing Hermes runtime interpreter. `--help` lists the options. Named-profile homes, symlinked plugin/backup paths, symlinked config files and profiles owned by a different OS user are refused.

For offline installation, transfer `install.py`, the archive and matching `.sha256` file from the **same release** to the server. With the files together:

```bash
python3 install.py install --bundle multi-chat-0.1.0.tar.gz
python3 install.py install --bundle multi-chat-0.1.0.tar.gz --apply
```

The checksum file must be named `multi-chat-0.1.0.tar.gz.sha256`. Offline mode does not download anything. A source build produces the same files under `artifacts/`; see [development](development.md).

## Update, disable or remove

**Account for active work first.** In the affected TUI, `/stop` interrupts its current turn. **Close view only detaches.** Disabling or replacing the plugin can remove access to a working terminal even though gateway work continues. Do not change the same configuration concurrently from another installer or dashboard tab.

Destructive-to-the-view operations require both `--apply` and `--acknowledge-active-work`. The extra flag is an acknowledgement, not an automatic cancellation command.

### Update

Download `install.py` from the release you intend to install; its version must match its bundle. Then:

```bash
python3 install.py update
python3 install.py update --apply --acknowledge-active-work
```

The update stages validated files, archives the previous plugin outside discovery and preserves its previous enabled/disabled membership. If installation/configuration fails, it attempts to restore the prior plugin and consent. Failed replacement files remain archived for inspection; unrelated settings are not restored from an old full-config snapshot.

Rescan extensions and reload the browser afterward. **Python routes already loaded in a dashboard process do not hot-reload merely because the file changes.** If `plugin_api.py` changed, arrange an idle maintenance window and restart only the dashboard using your own deployment's normal service controls. The installer never restarts it for you. A new IIFE/CSS alone needs a page refresh.

### Disable or re-enable

```bash
python3 install.py disable
python3 install.py disable --apply --acknowledge-active-work

python3 install.py enable
python3 install.py enable --apply
```

Disable updates only this plugin's consent. On browser reload its navigation disappears; the backend consent gate also rejects the plugin API at request time. The files and conversation history remain. Imported Python code is not dynamically unloaded, but its route is gated.

### Uninstall without deleting conversations

```bash
python3 install.py uninstall
python3 install.py uninstall --apply --acknowledge-active-work
```

Uninstall disables the plugin and moves **only its directory** into a private backup under `<home>/plugin-backups/multi-chat/`. It does not delete `state.db`, sessions, projects, memories, credentials or other plugins. Rescan and reload to remove the navigation entry.

### Roll back

```bash
python3 install.py rollback
python3 install.py rollback --apply --acknowledge-active-work
```

The preview identifies the most recent restorable backup. Applying restores its plugin files and only its prior enabled/disabled membership; the current plugin is backed up first. Use `--backup` to choose a particular backup printed by an earlier operation. Backups must belong to this profile and remain inside its Multi Chat backup directory.

Do not move backups directly under `plugins/`: Hermes could discover another copy of the same manifest. Keep any backups private. Permanently delete an archive only after deciding you no longer need it.

## Optional browser cleanup

Close **all** Multi Chat tabs first. Leaving the saved layout/ownership records in place is harmless. If you want them removed, run this in the dashboard's browser console:

```javascript
sessionStorage.removeItem("hermes.multi-chat.default.v1");
indexedDB.deleteDatabase("hermes-multi-chat-ownership-v1");
for (const key of Object.keys(localStorage)) {
  if (key.startsWith("hermes.multi-chat.released.")) localStorage.removeItem(key);
}
```

Do not clear all site data: it includes unrelated dashboard state/auth. Removing ownership records while another view is alive can defeat collision protection.

**Next:** [Use your panes](usage.md) · [Troubleshoot installation](troubleshooting.md) · [Understand compatibility](compatibility.md)
