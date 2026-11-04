# Security policy

## Report privately

Use [GitHub's private vulnerability reporting](https://github.com/BColsey/hermes-multi-chat/security/advisories/new) for security issues. Do not post credentials, exploitable details or private transcripts in a public issue. No response-time SLA is promised for this experimental preview.

Include the plugin version, Hermes version/commit, affected boundary and a minimal reproduction using disposable state. Never include passwords, API keys, cookies, socket tickets, real history databases, full configs/environment dumps, or unredacted logs.

## Automated scanning and SBOMs

See [security scanning and SBOMs](../docs/security.md) for schedules, severity gates, reports, release inventories and their explicit coverage limits. CodeQL analysis success is not a statement that every alert is resolved.

## Scope

This preview supports only the exact build/profile in [compatibility](../docs/compatibility.md). It runs trusted local plugin code in the dashboard process; it is not a sandbox for untrusted plugins. Browser ownership reservations are not a replacement for backend authorization, and do not coordinate separate browsers/devices or normal Chat/CLI clients.

The installer verifies archive integrity but releases are not independently signed. It does not weaken auth, change isolation, install runtime dependencies, restart services, or elevate tool permissions. Protect the server/profile as you would the authenticated Hermes terminal itself.

The documented retention-inspection/attachment race is a known limitation, not an atomic no-respawn guarantee. See [the explanation](../docs/compatibility.md#known-attachment-race).

For nonsensitive bugs, use the [bug report form](https://github.com/BColsey/hermes-multi-chat/issues/new/choose).
