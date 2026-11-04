# Compatibility and limits

[Docs](index.md) / Compatibility

## Supported preview configuration

| Component | Requirement |
| --- | --- |
| Hermes | **0.22.6**, commit `f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab` |
| Interface | Web Dashboard; not Hermes Desktop |
| Profile | Default only |
| Plugin execution | Existing `plugins.isolation: in_process` |
| SDK | Dashboard SDK 1.1.0 as shipped in the pinned build |
| Server | POSIX PTY environment; native Linux verified |
| Browser | Chromium 145 verified; IndexedDB/session/local storage must work |
| Installation | Python 3.11+; prebuilt release needs no Node.js/npm |

The installer and frontend reject unknown builds. This is deliberate: the read-only adapter observes internal PTY/session registries that are not stable public APIs. A version label alone does not establish compatibility with a different commit. Locally modified core code still requires revalidation even if its reported commit matches.

Do not downgrade/patch a working Hermes installation just to bypass this guard. Wait for a verified compatible plugin release, or perform an isolated compatibility assessment and its regression tests.

## What was verified

The [release verification summary](../verification/0.1.1.json) records checks without private credentials, machine paths or transcripts. v0.1.1 changes licensing/version metadata only: runtime/backend bytes match v0.1.0, whose [browser verification](../verification/0.1.0.json) remains the basis; those browser tests were not rerun for this notice-only release.

- Frontend typecheck, lint, unit tests, local bundle build and runtime dependency audit.
- Read-only adapter validation and retained/not-retained behavior with synthetic registries.
- Installer checksum/path validation, preview-only behavior, file/config failure recovery, disable/uninstall/rollback and scope refusal.
- Actual Hermes config-writer integration against **temporary profiles**, preserving unrelated model/plugin settings, comments and a history sentinel.
- Real Hermes browser tests: independent conversations/workspaces/input; pane resizing/maximizing without remounts; refresh/reconnect without prompt replay; retained-terminal loss; native `/new` and `/resume`; session-only model changes; delayed workspace responses; auth and single-use tickets; normal Chat; disable/removal with history retained; early-input refusal without partial prompts.
- Cloned sessionStorage with Web Locks unavailable, including a real plain LAN HTTP origin. Loopback HTTP is a secure browser context; the portable test records which context it used instead of pretending they are the same.

Screenshots use only disposable workspaces and native TUI output. They do not demonstrate a model tool run.

## Known attachment race

Before automatic reattachment, the adapter observes whether a PTY is retained. The following WebSocket upgrade is a separate operation. If the child exits between those two operations, the pinned Hermes backend can create an **idle replacement** before the plugin notices a mismatch.

**No prompt is replayed**, and ordinary detected retention loss refuses automatic creation. Nevertheless, “never respawn under any timing” is not guaranteed. Making the operation atomic requires an additive core/upstream `attach_only` feature. This release neither patches Hermes nor claims that feature exists.

One explicit new/resume selection permits one creation attempt. If its acknowledgement is lost, you may need to choose the session again rather than have the plugin risk duplicate work.

## Retention is not job scheduling

The existing backend retains at most **16 PTYs**, with a **30-minute detached TTL** and **1 MiB replay buffer** per terminal. Capacity pressure can evict detached terminals earlier. Gateway execution can outlive a terminal; expiry is not a reliable cancellation mechanism.

These are the inspected build's behavior, not limits increased by this plugin. See [lifecycle](usage.md#closing-a-view-is-not-stopping-work) before closing a view, disabling the plugin or restarting anything.

## Not yet verified

- Actual model inference/streaming, model-driven tool execution and approval/clarification paths end to end.
- Long-running model work and a 30-minute idle/retention soak.
- Firefox, Safari and real mobile-device IME/OS clipboard permissions.
- Four-pane model/tool memory use, throughput or performance under load.
- Arbitrary providers, named profiles, plugin-host isolation or future Hermes builds.

Native TUI paths remain in place, but preserving a path is not the same as testing it. No permissions, authentication policies, model defaults or production resource limits are changed to compensate.

## Browser ownership boundary

Atomic reservations coordinate pages in **one browser origin/storage partition**. They do not coordinate another browser/device, a normal Chat tab or a CLI session. Explicit resume warns about those clients. Crash recovery is manual; a background tab must never lose ownership merely because it is quiet.

[Use Multi Chat](usage.md) · [Troubleshoot](troubleshooting.md) · [Integration details](contracts.md)
