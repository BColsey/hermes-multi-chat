# Multi Chat for Hermes

**Your projects, side by side. One dashboard.**

[![Checks](https://github.com/BColsey/hermes-multi-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/BColsey/hermes-multi-chat/actions/workflows/ci.yml)
[![Security](https://github.com/BColsey/hermes-multi-chat/actions/workflows/security.yml/badge.svg)](https://github.com/BColsey/hermes-multi-chat/actions/workflows/security.yml)
[Download v0.2.2 preview](https://github.com/BColsey/hermes-multi-chat/releases/tag/v0.2.2) · [Install](docs/installation.md) · [Docs](docs/index.md) · [Report a bug](https://github.com/BColsey/hermes-multi-chat/issues/new/choose)

Multi Chat adds an **adjustable 1–16-pane workspace** to the existing **Hermes Web Dashboard**. Each pane runs the real Hermes TUI in its own conversation and project. The normal Chat page stays exactly where it is.

![Five independent Hermes TUI conversations in an adjustable Multi Chat layout](docs/media/five-panes.png)

*Disposable demo projects with native TUI help output; no model responses. Account/session identifiers are masked.*

> **Experimental preview.** Supports only Hermes **0.22.6**, commit [`f0d94882e89a`](https://github.com/NousResearch/hermes-agent/commit/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab), on a default-profile dashboard with `plugins.isolation: in_process`. Other builds are refused—not silently assumed compatible. Read the [known limits](docs/compatibility.md) before installing.

## Why Multi Chat?

- **Separate projects, separate conversations.** Choose a parent **Projects directory** to populate all pane dropdowns from its subfolders, use **Other folder…** for a manual path, or resume a chat without changing its workspace.
- **The real terminal experience.** Native TUI input, slash commands, tool output and approval UI—not a second chat implementation.
- **A layout that stays out of your way.** Resize, maximize and restore; panes stack on narrow screens. Layout changes do not recreate terminals.
- **Refresh without retyping.** Preserve selections and reuse retained terminals. Prompts are never automatically replayed.
- **HTTP-safe isolation.** Per-pane identities and atomic browser reservations work without Web Locks, including cloned tabs.
- **No core patch.** Uses the Dashboard plugin SDK, locally bundled xterm assets and a small read-only FastAPI adapter. No extra service, second React or runtime CDN.

## Installation disclosures

The backend adapter runs **inside the dashboard process with its authority**, not in a sandbox. It reads undocumented `hermes_cli.web_server` / `web_server_chat` PTY registries and core-owned active-session marker files to verify retention and identity. It does not patch core methods or mutate those registries. This private seam can break on any core change and may require a public API before catalog acceptance; the exact-build/default-profile/in-process restrictions are intentional.

Starting/resuming a pane explicitly asks Hermes to launch/attach a **real TUI process and agent session**. Native tools, shell execution, provider network calls and approvals remain Hermes's responsibility under your existing settings. Hidden panes continue working. The plugin adds no executor, automatic approval, resource-limit increase, telemetry, runtime CDN or independent external service.

The plugin uses SDK-managed, authenticated same-origin APIs, including existing session/project metadata and, for explicit directory browsing, the host's read-only filesystem listing. Directory browsing follows native file-access restrictions and does not read file contents or create/register projects. It does not read credential stores such as `.env`, `auth.json`, browser passwords or another tool's login. Browser sessionStorage holds layouts/workspaces/selections; IndexedDB/localStorage hold session/attachment ownership identifiers and release proofs—not transcripts, stored prompts or credentials. The adapter reads only core identity markers and returns retention/session/attachment metadata through an authenticated route.

The [catalog distribution and complete disclosures](catalog/README.md) omit the standalone installer and development tooling. It has no self-updater or agent capabilities; future catalog updates require a reviewed SHA-bump PR. Catalog packaging is not catalog approval. [Maintainer review](https://github.com/NousResearch/hermes-agent/pull/149251) requires a public PTY-status seam and feature-based compatibility before listing; this release does not resolve those requests. See the [review procedure](docs/catalog.md).

## Install in a few minutes

Run these commands **on the machine that runs Hermes**, as the same OS user. Python 3.11+ and a compatible, already working Hermes installation are required. No Node.js, pip install, dashboard password or API token is needed to install the prebuilt release.

```bash
curl --fail --location --output install.py \
  https://github.com/BColsey/hermes-multi-chat/releases/download/v0.2.2/install.py

python3 install.py install          # verify compatibility + checksum; preview only
python3 install.py install --apply  # install and enable after you review the plan
```

Then open **Hermes → Plugins → Rescan dashboard extensions**, reload the page, and choose **Multi Chat**. Choose a project from each pane’s dropdown (or **Other folder…** for an absolute server path) and start a conversation. Wait for the pane's **connected** badge and the TUI's **ready** status before typing; an initial verification notice means input is not ready.

The installer verifies the pinned release archive, changes only this plugin's consent, and never restarts a service or changes model/auth/tool settings. Downloading the installer is not the same as executing it: inspect it first if required by your security policy. Checksums detect corruption; they are not independent publisher signatures.

**Custom Hermes paths, offline install or an existing copy?** Use the [installation guide](docs/installation.md). Start with `python3 install.py doctor` if anything is unclear.

## Everyday use

Choose any **Visible panes** count from **1 to 16**. The grid adapts automatically; new slots stay empty until you explicitly start/resume a conversation. Reducing the count hides extra views without disconnecting them. Drag separators—or Tab to them and use arrow keys. **Maximize** expands a pane; **Restore** brings back the layout. Alt+Shift+1–9 selects an existing pane.

The backend's existing **16-terminal cap is shared** with other dashboard views; sixteen layout slots do not guarantee sixteen available PTYs. Saved two/four-pane layouts migrate without changing their conversation identities.

Use the native `/model` picker, or `/model provider:model --session`, for a per-conversation model. Avoid `--global` unless you intentionally want a profile-wide change.

**Close view is not stop work.** Use `/stop` in the intended TUI to interrupt its current turn. Detached terminals have a 30-minute retention policy with earlier eviction possible; gateway-owned work can outlive the terminal. Hosted `/exit` is disabled. See [lifecycle and recovery](docs/usage.md#closing-a-view-is-not-stopping-work).

## Manage it safely

Every management command previews first. Updates and removal require an explicit active-work acknowledgement when applied.

```bash
python3 install.py doctor
python3 install.py update
python3 install.py disable --apply --acknowledge-active-work
python3 install.py uninstall --apply --acknowledge-active-work
python3 install.py rollback  # preview the most recent restorable backup
```

Uninstall moves plugin files into a private backup outside plugin discovery. It does **not** delete conversations. [Full update, removal and rollback instructions →](docs/installation.md#update-disable-or-remove)

## Know the boundaries

A rare child-exit race between retention inspection and WebSocket attachment can still create an **idle** replacement. No prompt is replayed. A strict atomic attach-only guarantee needs an upstream/core capability that this plugin does not add.

Model-driven tools, tool approvals/clarifications, long-running model work and real mobile IME/OS clipboard permissions have **not** been verified end to end. [Compatibility and limitations](docs/compatibility.md) distinguish tested behavior from preserved native paths.

Each pane consumes a real TUI process and session context; it is not a lightweight transcript preview. Existing service limits are not increased.

## Build, verify and contribute

```bash
git clone https://github.com/BColsey/hermes-multi-chat.git
cd hermes-multi-chat
npm ci --ignore-scripts
npm run typecheck && npm run lint && npm test
npm run package
```

See [development](docs/development.md) for Python checks, isolated real-dashboard browser tests, release packaging and contribution guidance. [Verification summary](verification/0.2.2.json) · [security scans and SBOMs](docs/security.md) · [third-party notices](docs/third-party.md) · [security policy](.github/SECURITY.md)

### Licensing

[MIT](LICENSE) © 2026 BColsey. Bundled dependencies retain their own licenses.

---

A community plugin for the Hermes Web Dashboard. Not affiliated with or endorsed by Nous Research.
