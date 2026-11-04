"""Optional integration against an actual installed Hermes config writer.

Only temporary homes and synthetic settings are used; no real profile is copied.
"""

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_installer import archive, installer


@unittest.skipUnless(
    os.environ.get("HERMES_SOURCE") and os.environ.get("HERMES_PYTHON"),
    "Set HERMES_SOURCE and HERMES_PYTHON to test the actual Hermes config writer",
)
class HermesInstallIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="multi-chat-installer-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.source = Path(os.environ["HERMES_SOURCE"])
        self.python = Path(os.environ["HERMES_PYTHON"])
        self.seed(self.home)
        (self.home / "state.db").write_bytes(
            b"disposable history sentinel, not opened as SQLite"
        )
        self.bundle = self.root / "bundle.tar.gz"
        archive(self.bundle)
        self.runtime = installer.Runtime(self.home, self.source, self.python)

    def seed(self, home):
        command = """import pathlib, sys
sys.path.insert(0,sys.argv[1])
from hermes_cli.config import atomic_config_write
atomic_config_write(pathlib.Path(sys.argv[2])/'config.yaml', {'model': {'model':'installer-sentinel-model','provider':'custom'},'plugins':{'enabled':['unrelated-plugin'],'disabled':[]},'dashboard':{'theme':'mono'}}, extra_content_on_create='\\n# preserve this fixture comment\\n')
"""
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.root),
            "HERMES_HOME": str(home),
        }
        subprocess.run(
            [str(self.python), "-c", command, str(self.source), str(home)],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_real_writer_install_dry_run_disable_remove_and_rollback(self):
        config = self.home / "config.yaml"
        original = config.read_bytes()
        installer.install_bundle(
            self.runtime, self.bundle, apply=False, update=False, acknowledge=False
        )
        self.assertEqual(config.read_bytes(), original)
        self.assertFalse((self.home / "plugins").exists())
        installer.install_bundle(
            self.runtime, self.bundle, apply=True, update=False, acknowledge=False
        )
        self.assertTrue(self.runtime.inspect()["enabled"])
        installer.manage(self.runtime, "disable", apply=True, acknowledge=True)
        self.assertTrue(self.runtime.inspect()["disabled"])
        installer.manage(self.runtime, "uninstall", apply=True, acknowledge=True)
        self.assertFalse((self.home / "plugins/multi-chat").exists())
        installer.manage(self.runtime, "rollback", apply=True, acknowledge=True)
        self.assertTrue(
            (self.home / "plugins/multi-chat/dashboard/manifest.json").exists()
        )
        self.assertTrue(self.runtime.inspect()["disabled"])
        for text in [
            "installer-sentinel-model",
            "unrelated-plugin",
            "theme: mono",
            "preserve this fixture comment",
        ]:
            self.assertIn(text, config.read_text())
        self.assertEqual(
            (self.home / "state.db").read_bytes(),
            b"disposable history sentinel, not opened as SQLite",
        )

    def test_real_profile_scope_guard_refuses_a_named_profile(self):
        named = self.home / "profiles/not-default"
        named.mkdir(parents=True)
        self.seed(named)
        before = hashlib.sha256((named / "config.yaml").read_bytes()).hexdigest()
        with self.assertRaises(installer.InstallError):
            installer.Runtime(named, self.source, self.python).inspect()
        self.assertEqual(
            hashlib.sha256((named / "config.yaml").read_bytes()).hexdigest(), before
        )
