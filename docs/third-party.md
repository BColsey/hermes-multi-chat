# Third-party notices

[Docs](index.md) / Notices

The prebuilt dashboard bundle includes these pinned packages:

| Package | Version | License |
| --- | --- | --- |
| `@xterm/xterm` | 6.0.0 | MIT |
| `@xterm/addon-fit` | 0.11.0 | MIT |
| `@xterm/addon-unicode11` | 0.9.0 | MIT |

Their original license text is copied into `dashboard/dist/licenses/` in every plugin archive. The installed bundle also carries a short third-party notice banner. Maintainers must keep those notices when rebuilding or redistributing the bundled dependencies.

React is supplied by the host Hermes dashboard; Multi Chat does not ship another copy. Build/test tools are development dependencies, not services or packages installed into Hermes by `install.py`.

This project has not yet selected a project-wide reuse license. Dependency licenses do not grant a license to unrelated project code. Hermes and Nous Research names identify the integration; this is an independent community plugin.

[README](../README.md#licensing) · [Build and release](development.md#release-checklist)
