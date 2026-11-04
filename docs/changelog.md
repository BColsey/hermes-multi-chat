# Changelog

[Docs](index.md) / Changelog

## 0.1.0 — experimental preview

- Add `/multi-chat` with two/four independent real Hermes TUI panes, project/session selection, resizable layouts, maximize/restore and narrow-screen stacking.
- Preserve native auth, model/tool permissions, session behavior and normal Chat.
- Add atomic browser reservations, explicit stale recovery, retained-terminal inspection and conservative reconnect behavior without prompt replay.
- Reject a whole early-input attempt until session identity is verified, avoiding partial slash commands or unintended prompts.
- Include a preview-first Python installer, checksum validation, per-plugin consent and private backup/rollback.
- Bundle pinned xterm assets and notices locally; host React comes from Hermes.
- Document exact-build compatibility, retention/ownership boundaries, verified coverage and the remaining non-atomic attach race.

See [compatibility and limitations](compatibility.md) before use. This is not a stable/general-Hermes release.
