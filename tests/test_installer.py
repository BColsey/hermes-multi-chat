"""Installer contracts use temporary files and synthetic config, never a real profile."""

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "multi_chat_installer", Path(__file__).resolve().parents[1] / "install.py"
)
installer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = installer
spec.loader.exec_module(installer)


def archive(path, extras=None):
    manifest = {
        "name": "multi-chat",
        "version": "0.1.0",
        "tab": {"path": "/multi-chat"},
        "entry": "dist/index.js",
        "css": "dist/style.css",
        "api": "plugin_api.py",
    }
    files = {
        "multi-chat/dashboard/manifest.json": json.dumps(manifest).encode(),
        "multi-chat/dashboard/plugin_api.py": b"# read only",
        "multi-chat/dashboard/dist/index.js": b"(function(){})();",
        "multi-chat/dashboard/dist/style.css": b".mc-root{}",
    }
    files.update(extras or {})
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            item = tarfile.TarInfo(name)
            if isinstance(data, tarfile.TarInfo):
                tar.addfile(data)
            else:
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))
    path.with_name(path.name + ".sha256").write_text(
        hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name + "\n"
    )


class FakeRuntime:
    def __init__(self, home):
        self.home = home
        self.config = {
            "model": {"provider": "local", "model": "unchanged"},
            "plugins": {"enabled": ["other"], "disabled": []},
        }
        self.changes = []
        self.fail_enable_once = False
        self.fail_disable_once = False

    def inspect(self):
        return {
            "version": installer.HERMES_VERSION,
            "commit": installer.HERMES_COMMIT,
            "default_profile": True,
            "isolation": "in_process",
            "enabled": "multi-chat" in self.config["plugins"]["enabled"],
            "disabled": "multi-chat" in self.config["plugins"]["disabled"],
        }

    def consent(self, enabled, disabled):
        if not enabled and self.fail_disable_once:
            self.fail_disable_once = False
            raise installer.InstallError("synthetic initial disable failure")
        if enabled and self.fail_enable_once:
            self.fail_enable_once = False
            raise installer.InstallError("synthetic config write failure")
        self.config = installer.change_consent(self.config, enabled, disabled)
        self.changes.append((enabled, disabled))


class InstallerTests(unittest.TestCase):
    def test_changes_only_this_plugins_membership_and_is_idempotent(self):
        original = {
            "model": {"name": "unchanged"},
            "dashboard": {"theme": "unchanged"},
            "plugins": {
                "enabled": ["other", "multi-chat"],
                "disabled": ["disabled-other", "multi-chat"],
                "isolation": "in_process",
            },
        }
        result = installer.change_consent(original, True, False)
        self.assertEqual(result["plugins"]["enabled"], ["other", "multi-chat"])
        self.assertEqual(result["plugins"]["disabled"], ["disabled-other"])
        self.assertEqual(result["model"], original["model"])
        self.assertEqual(result["dashboard"], original["dashboard"])
        self.assertEqual(result, installer.change_consent(result, True, False))
        self.assertIn("multi-chat", original["plugins"]["disabled"])

    def test_malformed_consent_is_not_replaced(self):
        with self.assertRaises(installer.InstallError):
            installer.change_consent({"plugins": {"enabled": "other"}}, True, False)

    def test_checksum_is_required_and_bound_to_the_filename(self):
        digest = "a" * 64
        self.assertEqual(
            installer.parse_checksum(digest + "  bundle.tar.gz\n", "bundle.tar.gz"),
            digest,
        )
        for text in [
            digest + "  other.tar.gz",
            "broken",
            digest + "  ../bundle.tar.gz",
        ]:
            with self.assertRaises(installer.InstallError):
                installer.parse_checksum(text, "bundle.tar.gz")

    def test_archive_extraction_rejects_escape_links_and_unexpected_code(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for bad in [
                "../outside",
                "/absolute",
                "multi-chat/dashboard/../../outside",
                "multi-chat/unexpected.py",
            ]:
                bundle = root / "bundle.tar.gz"
                archive(bundle, {bad: b"not allowed"})
                with self.assertRaises(installer.InstallError):
                    installer.extract_bundle(bundle, root / "stage")
            link = tarfile.TarInfo("multi-chat/dashboard/dist/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/outside"
            archive(bundle, {link.name: link})
            with self.assertRaises(installer.InstallError):
                installer.extract_bundle(bundle, root / "stage")
            self.assertFalse((root / "outside").exists())

    def test_dry_run_does_not_create_profile_files_or_change_consent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "bundle.tar.gz"
            archive(bundle)
            runtime = FakeRuntime(root / "profile")
            result = installer.install_bundle(
                runtime, bundle, apply=False, update=False, acknowledge=False
            )
            self.assertFalse(result["applied"])
            self.assertFalse(runtime.home.exists())
            self.assertEqual(runtime.changes, [])

    def test_install_disable_uninstall_and_rollback_preserve_history_and_other_settings(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "bundle.tar.gz"
            archive(bundle)
            home = root / "profile"
            home.mkdir()
            (home / "state.db").write_bytes(b"disposable-history-sentinel")
            runtime = FakeRuntime(home)
            original_model = copy.deepcopy(runtime.config["model"])
            installer.install_bundle(
                runtime, bundle, apply=True, update=False, acknowledge=False
            )
            self.assertTrue(
                (home / "plugins/multi-chat/dashboard/manifest.json").is_file()
            )
            self.assertIn("multi-chat", runtime.config["plugins"]["enabled"])
            with self.assertRaises(installer.InstallError):
                installer.manage(runtime, "disable", apply=True, acknowledge=False)
            installer.manage(runtime, "disable", apply=True, acknowledge=True)
            self.assertIn("multi-chat", runtime.config["plugins"]["disabled"])
            result = installer.manage(
                runtime, "uninstall", apply=True, acknowledge=True
            )
            self.assertFalse((home / "plugins/multi-chat").exists())
            self.assertTrue(Path(result["backup"]).is_dir())
            installer.manage(runtime, "rollback", apply=True, acknowledge=True)
            self.assertTrue(
                (home / "plugins/multi-chat/dashboard/manifest.json").exists()
            )
            self.assertIn("multi-chat", runtime.config["plugins"]["disabled"])
            self.assertEqual(runtime.config["model"], original_model)
            self.assertEqual(
                (home / "state.db").read_bytes(), b"disposable-history-sentinel"
            )
            self.assertIn("other", runtime.config["plugins"]["enabled"])

    def test_failed_update_restores_the_original_plugin_and_consent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "bundle.tar.gz"
            archive(bundle)
            runtime = FakeRuntime(root / "profile")
            installer.install_bundle(
                runtime, bundle, apply=True, update=False, acknowledge=False
            )
            marker = runtime.home / "plugins/multi-chat/local-customization.txt"
            marker.write_text("keep")
            before = copy.deepcopy(runtime.config)
            runtime.fail_enable_once = True
            with self.assertRaises(installer.InstallError):
                installer.install_bundle(
                    runtime, bundle, apply=True, update=True, acknowledge=True
                )
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(runtime.config, before)

    def test_failure_before_moving_the_old_plugin_never_removes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "bundle.tar.gz"
            archive(bundle)
            runtime = FakeRuntime(root / "profile")
            installer.install_bundle(
                runtime, bundle, apply=True, update=False, acknowledge=False
            )
            marker = runtime.home / "plugins/multi-chat/local-customization.txt"
            marker.write_text("keep")
            runtime.fail_disable_once = True
            with self.assertRaises(installer.InstallError):
                installer.install_bundle(
                    runtime, bundle, apply=True, update=True, acknowledge=True
                )
            self.assertEqual(marker.read_text(), "keep")

    def test_decompressed_archive_limit_includes_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "bundle.tar.gz"
            archive(bundle)
            limit = installer.MAX_BYTES
            try:
                installer.MAX_BYTES = 4096
                with self.assertRaises(installer.InstallError):
                    installer.extract_bundle(bundle, root / "stage")
            finally:
                installer.MAX_BYTES = limit

    def test_unknown_build_or_non_default_scope_is_refused(self):
        info = {
            "version": installer.HERMES_VERSION,
            "commit": installer.HERMES_COMMIT,
            "default_profile": True,
            "isolation": "in_process",
        }
        installer.require_compatible(info)
        for key, value in [
            ("commit", "unknown"),
            ("default_profile", False),
            ("isolation", "host"),
        ]:
            with self.assertRaises(installer.InstallError):
                installer.require_compatible({**info, key: value})


if __name__ == "__main__":
    unittest.main()
