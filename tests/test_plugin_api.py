"""Read-only registry inspection; no real profile, PTY or transcript is opened."""

import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location(
    "multi_chat_api", Path(__file__).resolve().parents[1] / "dashboard/plugin_api.py"
)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class PaneInspectionTests(unittest.TestCase):
    def test_reports_only_the_requested_retained_terminal_and_current_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "marker.json"
            marker.write_text(
                json.dumps(
                    {"session_id": "new-after-slash-new", "private": "not returned"}
                )
            )
            key = "a" * 32 + "\0default\0original-resume"
            session = SimpleNamespace(
                key=key,
                active_session_file=marker,
                alive=True,
                bridge=SimpleNamespace(is_alive=lambda: True),
            )
            result = plugin.inspect_pane(
                {"channel": marker}, {key: session}, "channel", "a" * 32
            )
            self.assertEqual(
                result,
                {
                    "retained": True,
                    "session_id": "new-after-slash-new",
                    "params": {"channel": "channel", "attach": key},
                },
            )
            self.assertEqual(
                plugin.inspect_pane(
                    {"channel": marker}, {key: session}, "channel", "b" * 32
                ),
                {"retained": False},
            )

    def test_missing_dead_or_mismatched_terminal_is_not_a_spawn_permission(self):
        marker = Path("/nonexistent/development-marker")
        session = SimpleNamespace(
            key="a" * 32,
            active_session_file=marker,
            alive=False,
            bridge=SimpleNamespace(is_alive=lambda: False),
        )
        self.assertEqual(
            plugin.inspect_pane({}, {}, "c", "a" * 32), {"retained": False}
        )
        self.assertEqual(
            plugin.inspect_pane({"c": marker}, {session.key: session}, "c", "a" * 32),
            {"retained": False},
        )

    def test_not_yet_initialized_marker_does_not_hide_a_living_pty(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "pending.json"
            marker.touch()
            key = "a" * 32
            session = SimpleNamespace(
                key=key,
                active_session_file=marker,
                alive=True,
                bridge=SimpleNamespace(is_alive=lambda: True),
            )
            result = plugin.inspect_pane({"c": marker}, {key: session}, "c", key)
            self.assertTrue(result["retained"])
            self.assertIsNone(result["session_id"])


if __name__ == "__main__":
    unittest.main()
