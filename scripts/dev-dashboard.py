#!/usr/bin/env python3
"""Run the installed Hermes dashboard with disposable HOME/state.

Invoke with the installed Hermes runtime Python, not system Python. No live
profile, login or model credential is read. This script is development-only.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import site
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--port", type=int, default=9137)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--runtime-site", type=Path)
parser.add_argument("--runtime-python", type=Path)
args = parser.parse_args()
if args.runtime_site is None:
    args.runtime_site = (
        Path(sys.prefix)
        / "lib"
        / f"python{sys.version_info.major}.{sys.version_info.minor}"
        / "site-packages"
    )
    sys.argv.extend(["--runtime-site", str(args.runtime_site)])
if args.runtime_python is None:
    args.runtime_python = Path(sys.executable)
    sys.argv.extend(["--runtime-python", str(args.runtime_python)])
# PM can re-enter this development script with -I before activating its site.
# The explicitly selected same-ABI dependency site is read-only, not a core patch.
site.addsitedir(str(args.runtime_site))
sys.argv[0] = str(Path(__file__).resolve())
root = Path(__file__).resolve().parent.parent
source = args.source.resolve()
if not (source / "hermes_cli/web_server.py").is_file():
    parser.error("--source must name an installed Hermes source tree")
private = root / ".dev"
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
home = private / "user"
profile = home / ".hermes"
profile.mkdir(parents=True, exist_ok=True)
# Do not inherit model tokens, profile routing, proxy credentials or service state.
kept = {
    k: v
    for k, v in os.environ.items()
    if k in ("PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME")
}
os.environ.clear()
os.environ.update(kept)
os.environ.update(
    {
        "HOME": str(home),
        "HERMES_HOME": str(profile),
        "HERMES_RUNTIME_DIR": str(private / "runtime"),
        "XDG_CACHE_HOME": str(private / "cache"),
        "XDG_CONFIG_HOME": str(private / "config"),
        "XDG_DATA_HOME": str(private / "data"),
        "HERMES_WEB_DIST": str(source / "hermes_cli/web_dist"),
        "HERMES_TUI_DIR": str(private / "tui"),
        "HERMES_PYTHON": str(args.runtime_python),
        "HERMES_PYTHON_SRC_ROOT": str(source),
        "PYTHONPATH": str(source),
        "NO_PROXY": ",".join(dict.fromkeys(["127.0.0.1", "localhost", args.host])),
    }
)
# Only copy prebuilt runtime assets; the installed core is never built or edited.
tui = private / "tui"
tui.mkdir(exist_ok=True)
shutil.copytree(source / "ui-tui/dist", tui / "dist", dirs_exist_ok=True)
plugin = profile / "plugins/multi-chat"
shutil.copytree(root / "dashboard", plugin / "dashboard", dirs_exist_ok=True)
for name in ("project-a", "project-b", "project-c", "project-d"):
    (private / name).mkdir(exist_ok=True)
sys.path.insert(0, str(source))
from hermes_cli.config import atomic_config_write
from plugins.dashboard_auth.basic import hash_password

login_path = private / "login.json"
if login_path.exists():
    login = json.loads(login_path.read_text())
else:
    login = {
        "provider": "basic",
        "username": "multi-chat-dev",
        "password": secrets.token_urlsafe(32),
    }
    login_path.write_text(json.dumps(login))
    os.chmod(login_path, 0o600)
if not (profile / "config.yaml").exists():
    atomic_config_write(
        profile / "config.yaml",
        {
            "model": {
                "provider": "custom",
                "model": "development-no-inference",
                "base_url": "http://127.0.0.1:1/v1",
                "api_key": "development-placeholder",
            },
            "terminal": {"backend": "local", "cwd": str(private / "project-a")},
            "approvals": {"mode": "manual"},
            "mcp_servers": {},
            "dashboard": {
                "basic_auth": {
                    "username": login["username"],
                    "password_hash": hash_password(login["password"]),
                    "secret": secrets.token_urlsafe(48),
                }
            },
        },
    )
from hermes_cli.config import read_raw_config

config = read_raw_config()
enabled = config.setdefault("plugins", {}).setdefault("enabled", [])
if "multi-chat" not in enabled:
    enabled.append("multi-chat")
    atomic_config_write(profile / "config.yaml", config)
# The dashboard's read-only session endpoints intentionally do not initialize DBs.
from hermes_state import SessionDB

SessionDB().close()
os.chdir(private / "project-a")
from hermes_cli.plugins import discover_plugins

discover_plugins()
from hermes_cli.web_server import start_server

print(f"Isolated development dashboard: http://{args.host}:{args.port}", flush=True)
start_server(host=args.host, port=args.port, open_browser=False, isolated=True)
