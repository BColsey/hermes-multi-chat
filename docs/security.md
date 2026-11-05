# Security scanning and SBOMs

[Docs](index.md) / Security

## Automated checks

The [Security workflow](https://github.com/BColsey/hermes-multi-chat/actions/workflows/security.yml) runs on pushes to `main`, trusted repository-owner pull requests, manual requests, and **Mondays at 06:23 UTC** on the owner's **R720 self-hosted runner**. Build checks and release SBOM generation use the same `self-hosted, linux, x64, r720-multi-chat` selector, with no GitHub-hosted fallback.

- **CodeQL, security-extended:** JavaScript/TypeScript, Python and GitHub Actions. Findings appear in the repository's **Security → Code scanning** tab. A successful analysis/upload is not a guarantee that there are no open alerts.
- **npm audit:** the entire locked npm tree, including development tools. High/critical findings fail the job; lower-severity findings remain visible in its `dependency-audits` artifact rather than being suppressed.
- **pip-audit:** Python test and security-tool requirements, including resolved transitive dependencies. Any known vulnerability or strict audit failure fails this check.
- **GitHub secret scanning and push protection:** repository-native protection for supported secret patterns. No scanner catches every credential format; keep the existing publication/privacy checks too.
- **Dependabot:** alerts/security-update PRs, plus weekly npm, pip and action-pin update PRs. There is no automatic merge or deployment.

Audit reports are retained as Actions artifacts for 30 days. Do not interpret a green severity gate as “all dependency findings resolved.” Review lower-severity development findings and keep test/lint tools maintained. Use current `main` for maintained development tooling; old release tags remain immutable.

These checks inspect the **public repository**, not a running Hermes server or private `.dev/` state. They do not exercise model/tool approvals, prove the known attachment race is absent, or certify the whole Hermes deployment. See [compatibility](compatibility.md).

## Runner trust boundary

The repository-scoped R720 worker is an unprivileged container with its own persistent home/work/cache volume, four CPU threads and 8 GiB RAM (no extra swap). It has no host project, Hermes credential directory, Docker socket or device mounts. Containers share the host kernel: this is not a sandbox for arbitrary hostile code.

Only owner-authored PRs whose head is in this repository may automatically run these jobs. Fork and bot PR jobs are skipped; an owner must review the code before explicitly dispatching a trusted branch. Repository policy additionally requires approval for **all external contributors**, not just first-time contributors. Do not approve a fork workflow that removes these protections or queues untrusted code on persistent workers. No `pull_request_target` checkout of an incoming PR is used.

These settings control this repository only. Nous controls the workflows/runners for an upstream Hermes catalog PR; R720 results do not bypass its maintainer approval or replace its required checks.

Dependabot's update-generation jobs are a separate GitHub-managed service: GitHub does not support self-hosting them for a **public** repository. Do not describe those jobs as moved to R720. Vulnerability alerts and the R720 npm/pip audits remain separate from automatic update PR generation.

Old release tags remain immutable and can contain the former hosted-runner definitions. Do not rerun workflows from those historical refs. For maintained automation use current `main`; SBOM dispatch on `main` reads a release tag as data without executing that tag's workflow. Runner unavailability queues jobs rather than selecting a hosted fallback.

## Download a release SBOM

Each release can carry these additional assets:

- `multi-chat-<version>.cdx.json` — **CycloneDX JSON 1.5**.
- `multi-chat-<version>.cdx.json.sha256` — its SHA-256 receipt.

For the current preview, download them from [v0.2.1](https://github.com/BColsey/hermes-multi-chat/releases/tag/v0.2.1). Verify the downloaded JSON alongside its receipt:

```bash
sha256sum --check multi-chat-0.2.1.cdx.json.sha256
```

The SBOM identifies the project and its **bundled npm runtime dependencies**, with versions, package URLs, license IDs, dependency relationships and registry integrity hashes. Distribution references bind it to the **exact plugin archive and installer SHA-256 hashes**.

**Scope matters:** host-provided Hermes, React and FastAPI, the Python standard library, and build/test/security tools are **not** components of this runtime inventory. They are not redistributed in the plugin archive. This is not a full host/container/build-environment SBOM, a vulnerability-free certificate, or an independent publisher signature.

Generation reads only package manifests/lockfile and explicit release artifacts. It does not crawl the workstation. Local directory names are normalized, and optional timestamps/serials are omitted for repeatable output with the same toolchain.

## Release automation

The [Release SBOM workflow](https://github.com/BColsey/hermes-multi-chat/actions/workflows/sbom.yml) runs when a release is published, or manually for an existing tag. It:

1. Validates the version tag and checks out that exact release's source in a separate directory.
2. Downloads only its plugin archive, installer and checksum receipts.
3. Verifies those hashes and generates a production-only inventory with npm's built-in `sbom` command. The job pins npm **10.9.9** in its temporary tool directory to preserve the published v0.2.0 generation-tool metadata. It does not install or run scripts from the released source.
4. Validates the official CycloneDX 1.5 schema.
5. Attaches the SBOM and its separate receipt without replacing existing assets or moving tags.

Only this release/manual workflow has release-write permission; it does not run on pull requests. Security analyses have only their required read/SARIF-upload permissions. Action references are pinned to full commit SHAs.

To backfill the current release from the default branch:

```bash
gh workflow run sbom.yml --repo BColsey/hermes-multi-chat --ref main --field tag=v0.2.1
```

Reruns verify identical existing metadata and upload only missing files. Different existing data fails for review rather than being overwritten. Original `SHA256SUMS`, archive, installer and tags remain unchanged. Future release tags must include the workflow to trigger automatically; older tags can use the manual path.

## Local checks

These commands use development-only tools; never install them into the running Hermes environment:

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-security.txt
pip-audit --strict -r requirements-dev.txt -r requirements-security.txt

npm run package
npm run sbom
(cd artifacts && sha256sum --check multi-chat-0.2.1.cdx.json.sha256)
```

The local command inventories the current checkout. Published metadata uses the exact release tag instead. Python environments without `ensurepip` should use an already available environment manager or the R720 workflow; do not install OS packages or modify a live Hermes environment just to run these checks.

[Report a vulnerability privately](../.github/SECURITY.md) · [Development and release](development.md) · [Third-party notices](third-party.md)
