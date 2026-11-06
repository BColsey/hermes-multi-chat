---
updated: 2026-11-05
type: howto
---

# Prepare a Hermes catalog review

[Docs](index.md) / Catalog submission

Submit Multi Chat as a **community Web Dashboard plugin**, not a Desktop plugin or a Nous-maintained extension. Follow Hermes's [catalog submission guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission); only its maintainers can approve a listing.

## Current admission blocker

[Maintainer review of PR #149251](https://github.com/NousResearch/hermes-agent/pull/149251) requested a public read-only dashboard PTY-status seam and feature-based compatibility instead of the exact version/commit guard and upper ceiling. Listing must wait on that public seam. v0.2.2 is a standalone experimental release; it keeps the tested restrictions and does **not** resolve those requests.

Request the public seam upstream, then implement and verify the supported feature probes against the relevant Hermes builds before changing the guard/range and re-pinning the submission. Do not merely bump its SHA, suppress the private-import warning or remove safety checks to suggest approval. The existing review candidate remains v0.2.1 until that work is addressed.

## Build the reviewable package

```bash
npm ci --ignore-scripts
npm run catalog
npm run catalog:check
npm run check:public
```

Commit the generated `catalog/` distribution alongside its source. Catalog installs clone an exact source commit: a release archive alone is insufficient. The catalog entry must use `subdir: catalog`.

The package contains only its manifest, README, MIT notice, no-op agent entrypoint, and the dashboard's manifest, read-only API, local IIFE/CSS and four license notices. It excludes the standalone installer, build metadata, development tools, credentials, evidence/state and self-updating code. The Python standard-library build preloads inputs, rejects version mismatches and unexpected/non-regular package entries, and checks runtime bytes against the normal build. Directory-relative opens pin every parent component and the final file without following symlinks; file type is checked on the opened descriptor before reading or truncating. Do not hand-edit generated payloads.

`__init__.py` supplies the empty `register(ctx)` entrypoint required by Hermes 0.22.6's directory-plugin validator. It registers no tools, hooks, middleware, providers, environment requirements or background jobs.

## Run Hermes's admission checks in isolation

Use a disposable **Hermes checkout and managed environment**, as well as throwaway `HOME`, `HERMES_HOME` and runtime state. Do not run the dependency-preparation option against a working installation: it calls PM's environment synchronizer even when this plugin declares no Python dependencies.

Use a clean clone/export of the plugin package too: Python's import probe can create untracked bytecode. Never copy that cache back into the committed distribution. Inside the isolated Hermes environment, validate the package with the same command used by catalog CI:

```bash
hermes plugins validate --install-deps ./catalog
```

Use an absolute package path if the isolated checkout has another working directory. Run the catalog's structural validator and executable-payload scanner from the upstream revision against which the entry will be proposed. Preserve their actual results; do not replace missing upstream CI with a local success claim.

The expected policy warning is **private core imports**:

- `hermes_cli.web_server._get_pty_active_session_files`
- `hermes_cli.web_server.app`
- `hermes_cli.web_server_chat.PTY_REGISTRY`

The handler also reads `PTY_REGISTRY._sessions` and corresponding core-owned session markers. No core method/table is replaced or mutated. These imports are still undocumented and version-sensitive. Keep the warning in the PR. If maintainers require a public retained-PTY identity/attachment-inspection API, discuss that seam rather than suppressing warnings or patching Hermes.

The validator's informational isolation audit is not runtime evidence: it can label a dashboard API host-ready without seeing these private in-process reads. Multi Chat continues to require existing **`plugins.isolation: in_process`**; do not advertise plugin-host support or change a user's isolation setting.

## Prepare the entry and review handoff

After committing and publishing the reviewed source, obtain its full pin:

```bash
git rev-parse HEAD
```

Add only `plugin-catalog/multi-chat.yaml` to a branch based on current `NousResearch/hermes-agent/main`. Use:

- Repository `https://github.com/BColsey/hermes-multi-chat`, `subdir: catalog`, that full 40-character **reachable** commit, and its matching version.
- `tier: community`, `maintainer: BColsey`, and Linux as the verified server platform.
- `requires_hermes: ">=0.22.6,<0.22.7"` in both package and entry. This bounded release range is not a claim that every 0.22.6 source commit works: disclose the exact `f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab` requirement, default profile and in-process constraint in `known_issues`.
- Empty tool/hook/middleware/environment capability arrays, matching the real registration probe.
- Screenshots pinned to the **same source commit**, using only the reviewed disposable demo images.
- Known limitations including private core reads, non-atomic reattachment, shared 16-PTY capacity, no cancellation on hiding, and unverified model/tool/load/browser paths.

The PR description must include the [installation disclosures](../catalog/README.md#installation-disclosures), the exact validation warning, test scope, source/package-byte equivalence and AI assistance. Link the reviewable source and aggregate evidence, never raw auth/session/browser reports. State that acceptance and support for the private seam are maintainer decisions, not conclusions of the scanner.

Search open and merged catalog PRs before submission. Keep the upstream PR data-only; do not change Hermes core, validation tooling or CI to admit this plugin. Submit an experimental review request, not an assertion of catalog approval.

## Keep updates reviewed

Catalog updates require another SHA-bump PR and maintainer review, then Hermes's normal plugin update command. Never add an in-plugin downloader or replacement updater to this package. Keep standalone-installer management separate, preserve later configuration/history during removal, and plan an idle dashboard restart separately when an update replaces already-imported Python code.

[Development checks](development.md) · [Compatibility](compatibility.md) · [Integration contracts](contracts.md) · [Aggregate packaging evidence](../verification/catalog-0.2.2.json)
