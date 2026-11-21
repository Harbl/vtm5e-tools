import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location(
    "release", Path(__file__).resolve().parents[1] / "scripts/build_release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_installable_archives_and_dependency_assets(self):
        modules = release.read_modules()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            release.build("v1.1.0", output)
            self.assertEqual(len(list(output.iterdir())), len(modules) * 2)
            for module_id, source in modules.items():
                manifest = json.loads((output / f"{module_id}.json").read_text("utf-8"))
                self.assertEqual(manifest["version"], "1.1.0")
                self.assertEqual(manifest["manifest"], f"{release.LATEST}/{module_id}.json")
                self.assertEqual(manifest["download"], f"{release.URL}/releases/download/v1.1.0/{module_id}.zip")
                for dep in manifest.get("relationships", {}).get("requires", []):
                    self.assertEqual(dep["manifest"], f"{release.URL}/releases/download/v1.1.0/{dep['id']}.json")
                    self.assertTrue((output / f"{dep['id']}.json").is_file())
                with ZipFile(output / f"{module_id}.zip") as archive:
                    self.assertIsNone(archive.testzip())
                    self.assertEqual(json.loads(archive.read("module.json")), manifest)
                    self.assertIn("LICENSE", archive.namelist())
                    for path in (release.ROOT / module_id).rglob("*"):
                        if path.is_file() and path.name != "module.json":
                            relative = path.relative_to(release.ROOT / module_id).as_posix()
                            self.assertEqual(archive.read(relative), path.read_bytes())
                self.assertEqual(release.read_modules()[module_id], source)

    def test_reject_invalid_tags_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            for tag in ("master", "1.1.0", "v1.1.0-rc.1", "v1/../../bad"):
                with self.assertRaises(ValueError):
                    release.build(tag, Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_reject_stale_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "stale.zip").touch()
            with self.assertRaises(ValueError):
                release.build("v1.1.0", output)


if __name__ == "__main__":
    unittest.main()
