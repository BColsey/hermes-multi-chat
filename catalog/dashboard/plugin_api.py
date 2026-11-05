"""Read-only default-profile PTY observations for the Multi Chat frontend.

Hermes 0.22.6 does not publish initial/session-switch metadata consistently.
No routes here create, kill, attach to, or write input to a terminal or agent.
Authentication and plugin consent are enforced by the dashboard's own gate.
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter()


def inspect_pane(files, sessions, channel, attachment):
    marker = files.get(channel)
    if marker is None:
        return {"retained": False}
    for key, session in list(sessions.items()):
        if key != attachment and not key.startswith(attachment + "\0"):
            continue
        if (
            session.active_session_file != marker
            or not session.alive
            or not session.bridge.is_alive()
        ):
            continue
        session_id = None
        try:
            # A marker is a tiny identity record, never a transcript.
            if marker.stat().st_size <= 4096:
                value = json.loads(marker.read_text())
                candidate = value.get("session_id")
                if isinstance(candidate, str) and candidate:
                    session_id = candidate
        except (OSError, ValueError, AttributeError):
            pass  # The TUI may still be booting; this is not permission to respawn it.
        # Return the registry's actual opaque attachment key, not a guessed
        # resume suffix: compression can change a session's canonical id.
        # Omitting profile/resume on reuse is safe ONLY on a default-profile
        # launch, checked by pane_state below, and avoids changing that key.
        return {
            "retained": True,
            "session_id": session_id,
            "params": {"channel": channel, "attach": key},
        }
    return {"retained": False}


@router.get("/pane")
async def pane_state(
    request: Request,
    channel: str = Query(pattern=r"^mc-[a-f0-9]{32}$"),
    attachment: str = Query(pattern=r"^[a-f0-9]{32}$"),
):
    from hermes_constants import (
        get_default_hermes_root,
        get_hermes_home,
        get_process_hermes_home,
    )
    from hermes_cli.web_server import _get_pty_active_session_files, app
    from hermes_cli.web_server_chat import PTY_REGISTRY

    launch = Path(get_process_hermes_home()).resolve()
    if (
        launch != Path(get_default_hermes_root()).resolve()
        or launch != Path(get_hermes_home()).resolve()
    ):
        raise HTTPException(
            403, "Multi Chat supports only the default-profile dashboard launch."
        )
    # Registry inspection must run on the dashboard loop, not in a plugin host.
    # Fail closed if a Hermes upgrade changes the verified registry contract.
    if request.app is not app or not hasattr(PTY_REGISTRY, "_sessions"):
        raise HTTPException(
            409, "This Hermes PTY registry is not supported by Multi Chat."
        )
    return inspect_pane(
        _get_pty_active_session_files(request.app),
        PTY_REGISTRY._sessions,
        channel,
        attachment,
    )
