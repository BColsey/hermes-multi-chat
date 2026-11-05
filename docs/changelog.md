# Changelog

[Docs](index.md) / Changelog

## 0.2.1 — project dropdowns

- Replace workspace text-box suggestions with a per-pane project dropdown showing project names and server paths.
- Keep **Other folder…** for manual paths, including when project discovery is unavailable; preserve saved selections, in-progress edits and resumed workspaces.
- Keep the Python API, permissions, storage schema and native TUI execution unchanged.
- Route trusted build/security/SBOM jobs to the isolated R720 worker, with fork/bot guards and no hosted-runner fallback.

## 0.2.0 — adjustable pane counts

- Replace fixed two/four presets with a **1–16 visible-pane selector** and an automatic, resizable grid.
- Keep existing terminal components and conversations connected when panes are hidden, revealed or maximized. New empty slots do not spawn agents.
- Migrate legacy layouts without changing pane/channel/attachment identities; preserve hidden conversations and applicable split sizes.
- Support Alt+Shift+1–9 for existing panes and keyboard/pointer resizing across multiple grid boundaries.
- Report connection readiness only after identity verification; allow live identity revalidation without spuriously rejecting input from other panes' metadata updates. Pending input never crosses a socket/session change.
- Preserve the existing shared 16-PTY limit and all execution/auth/model behavior. No backend/core patch is included.
- Add a minimal source-pinned catalog distribution, native-plugin metadata and explicit installation disclosures; catalog acceptance remains a maintainer decision.
- Verify native catalog admission and Git/subdirectory installation in disposable Hermes state without changing the dashboard runtime payload.

## 0.1.1 — MIT licensing

- License project code under MIT; preserve third-party notices.
- Include the full project notice in the prebuilt plugin archive and standalone installer.
- Update release links and package metadata. Terminal behavior is unchanged; the v0.1.0 tag/assets are preserved.

## 0.1.0 — experimental preview

- Add `/multi-chat` with two/four independent real Hermes TUI panes, project/session selection, resizable layouts, maximize/restore and narrow-screen stacking.
- Preserve native auth, model/tool permissions, session behavior and normal Chat.
- Add atomic browser reservations, explicit stale recovery, retained-terminal inspection and conservative reconnect behavior without prompt replay.
- Reject a whole early-input attempt until session identity is verified, avoiding partial slash commands or unintended prompts.
- Include a preview-first Python installer, checksum validation, per-plugin consent and private backup/rollback.
- Bundle pinned xterm assets and notices locally; host React comes from Hermes.
- Document exact-build compatibility, retention/ownership boundaries, verified coverage and the remaining non-atomic attach race.

See [compatibility and limitations](compatibility.md) before use. This is not a stable/general-Hermes release.
