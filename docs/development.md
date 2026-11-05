# Development and contributing

[Docs](index.md) / Development

Build locally, test the small seams, then exercise the **real Hermes dashboard in disposable state**. Never point the browser suite at a working profile.

## Toolchain

- Node.js **22+** and npm; use the committed `package-lock.json`.
- Python **3.11+** for the installer/unit suite and POSIX catalog packager. Hermes integration uses Hermes's own installed Python.
- GNU tar for deterministic release packaging (`--sort`, `--mtime`, `--transform`).
- Real-dashboard tests require the [pinned Hermes build](compatibility.md), its already working TUI/dependencies and Chromium via Playwright.

`requirements-dev.txt` contains test/lint tools only. Do not install it into a production Hermes environment. Runtime assets contain pinned xterm `6.0.0`, fit `0.11.0` and Unicode11 `0.9.0`; host React comes from Hermes.

## Local checks

```bash
npm ci --ignore-scripts
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt

npm run typecheck
npm run lint
npm test
npm run test:python
ruff format --check install.py dashboard catalog scripts tests
ruff check install.py dashboard catalog scripts tests
npm run check:public
npm run package
npm run catalog
npm run catalog:check
(cd artifacts && sha256sum --check SHA256SUMS)
npm audit --audit-level=high
```

The fast Python suite skips two **real Hermes config-writer** cases unless `HERMES_SOURCE` and `HERMES_PYTHON` are set. CI runs the fast checks in the isolated R720 self-hosted worker; it does not claim model-backed or real-dashboard browser coverage. Do not run untrusted pull requests on a machine with private Hermes state/credentials.

ESLint covers TypeScript; Prettier checks frontend/tests/build/config files. To format these after an edit:

```bash
npx prettier --write 'src/**/*.{ts,tsx,css}' 'tests/**/*.{ts,tsx}' \
  'scripts/*.mjs' '*.ts' 'eslint.config.mjs'
ruff format install.py dashboard catalog scripts tests
```

## Real Hermes config-writer tests

Use an existing supported installation. `doctor` is read-only; the following extracts its selected runtime path, not credentials:

```bash
export HERMES_SOURCE="$HOME/.hermes/hermes-agent"
export HERMES_PYTHON="$(python3 install.py doctor --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["runtime_python"])')"
npm run test:python
```

For a nonstandard source/home, pass the appropriate installer options to `doctor`. These tests create **temporary synthetic profiles**, exercise the installed config writer and verify unrelated model/plugin settings, comments, scope checks and a history sentinel. They do not copy a live config or open a real history database.

## Isolated real-dashboard browser tests

### Start a disposable server

Build once and install the test browser:

```bash
npm run build
npx playwright install chromium
```

The helper clears inherited provider/login credentials, uses `.dev/user/.hermes`, creates disposable projects and strong test-only password credentials, copies the plugin into that home, and points inference at an unavailable local endpoint. No provider calls should occur. It uses Hermes's native bootstrap/authentication and config writer, not a replacement backend.

For **manual local UI development**, a loopback bind is sufficient:

```bash
"$HERMES_PYTHON" scripts/dev-dashboard.py --source "$HERMES_SOURCE" --host 127.0.0.1 --port 9137
```

The **full browser suite** checks the cookie/ticket gate and insecure HTTP fallback, so use an explicit non-loopback IPv4 interface instead. On a Linux development server, for example:

```bash
export MULTI_CHAT_BIND_HOST="$(hostname -I | awk '{print $1}')"
export MULTI_CHAT_TEST_URL="http://${MULTI_CHAT_BIND_HOST}:9137"

"$HERMES_PYTHON" scripts/dev-dashboard.py \
  --source "$HERMES_SOURCE" --host "$MULTI_CHAT_BIND_HOST" --port 9137
```

Review the selected interface before starting. It must be your disposable development server, not a production listener. The non-loopback bind remains password-gated. Run the foreground server in a dedicated terminal or a named tmux session; wait for startup and check `/api/health`. Test credentials are in ignored `.dev/login.json`: use them locally, never paste them into an issue or commit them.

### Run and interpret the suite

From another terminal in the same checkout, with the same `MULTI_CHAT_TEST_URL`:

```bash
npm run test:browser
```

The fixture requires a gated dashboard, logs in once per worker, and verifies the exact disposable profile path before tests change settings. Tests run serially. The suite refuses common production ports; that is a guardrail, not permission to use an arbitrary live profile on another port.

Coverage includes independent sessions/workspaces and input, layout persistence without remounts, delayed workspace responses, native `/new`/`/resume`, session-only models, refresh/reconnect, detected PTY loss, cloned-tab collisions without Web Locks, anonymous/ticket gates, normal Chat, and disable/removal retaining history. The cloned-tab test records secure versus insecure browser context; loopback HTTP does **not** demonstrate a real insecure LAN origin.

Stop the disposable dashboard with Ctrl+C when finished. Inspect its child processes/readiness rather than assuming quiet logs mean it stopped. A gateway spawned for this disposable home can remain afterward; stop **only processes belonging to that exact `.dev/user/.hermes` home** using your process/service controls. Do not use a broad `pkill hermes`. Logs/state stay ignored under `.dev/` for private diagnosis.

### Keep evidence safe

Disable traces/HAR/full-page log capture containing auth or sessions. Use only disposable public-demo directories and native non-sensitive TUI output for screenshots. Redact account usage/status, private paths and session metadata. Do not publish `.dev/`, login storage, error-context files, raw Playwright reports or full environment/config dumps.

The committed [verification summary](../verification/0.2.1.json) is deliberately an aggregate, not a transcript or machine inventory. It separates a prior real-dashboard verification from the smaller GitHub CI suite.

## Source map

- `src/App.tsx` — pane controls, selection and layout.
- `src/TerminalHost.tsx` — xterm lifetime, identity observation and input gates.
- `src/ownership.ts` — atomic IndexedDB reservations and release/recovery.
- `src/transport.ts` — SDK-authenticated sockets, raw protocol and socket epochs.
- `src/pane-api.ts`, `src/state.ts` — creation/reuse policy and persisted state.
- `dashboard/plugin_api.py` — read-only retained-PTY observation.
- `install.py` — preview-first install, consent and backup/rollback.
- `scripts/build.mjs`, `scripts/package.mjs` — scoped assets, notices and deterministic archive.

Read [integration contracts](contracts.md) before changing transport, resume behavior or the backend adapter. Do not weaken authentication, share the stock Chat attachment/workspace preference, remount terminals for layout, replay input, or add another executor/composer.

## Release checklist

1. Keep `package.json`, `dashboard/manifest.json` and `install.py` versions in sync; update the pinned download links and changelog.
2. Run local checks and the real config-writer/browser integration against the supported Hermes commit. For notice/version-only releases, byte-compare the runtime/backend against the previously verified archive and explicitly record any browser-suite reuse instead. Record scope and failures honestly; do not substitute mocks for real runtime evidence.
3. Build twice and compare archive SHA-256. Inspect the tar member list: only `multi-chat/dashboard/` payload, never state/credentials.
4. Check documentation links and preview screenshots; run `npm run check:public` on the actual staged publication tree. Review secrets manually too; a text scanner is not a complete audit.
5. Tag the reviewed source, create an **experimental prerelease**, and upload only the archive, its `.sha256`, `install.py`, `install.py.sha256` and `SHA256SUMS` from `artifacts/`. Do not upload the whole artifacts directory.
6. Confirm the [Release SBOM workflow](security.md#release-automation) attached the validated runtime inventory and its checksum (or manually backfill an older tag). Do not replace existing assets.
7. Download the published files, verify checksums and preview the documented install. Publication is not a production installation/restart.

## Catalog distribution

`npm run catalog` produces the committed, minimal `catalog/` directory from the same runtime build. `npm run catalog:check` compares its exact payload and notices without repairing stale files. CI checks this after rebuilding, so the catalog cannot silently diverge from tested source. It excludes the standalone installer and development/security tools; no new runtime dependency or self-updater is introduced.

Use the [catalog review procedure](catalog.md) for isolated Hermes validation, required disclosures and a data-only upstream entry PR. Do not run `--install-deps` against a live Hermes checkout/environment, suppress private-import warnings, or describe an unmerged submission as an approved listing.

## Contributing

Open a focused issue before proposing a new integration boundary. Use disposable reproductions, add a regression for behavioral fixes and keep one writer per shared working tree. Preserve the explicit compatibility/ownership/lifecycle guarantees and document any remaining limits.

Project code is [MIT-licensed](../LICENSE). Preserve the bundled project and third-party notices. Report sensitive issues [privately](../.github/SECURITY.md).

[README](../README.md) · [Compatibility](compatibility.md) · [Third-party notices](third-party.md)
