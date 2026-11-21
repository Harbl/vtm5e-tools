"""Validate source manifests and build Foundry release assets (stdlib only)."""

import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "Harbl/vtm5e-tools"
URL = f"https://github.com/{REPOSITORY}"
LATEST = f"{URL}/releases/latest/download"


def read_modules():
    modules = {}
    for path in sorted(ROOT.glob("vtm5e-*/module.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        module_id = path.parent.name
        if data["id"] != module_id:
            raise ValueError(f"{path}: id must match its directory")
        for field in ("title", "description", "version", "compatibility", "authors"):
            if not data.get(field):
                raise ValueError(f"{module_id}: missing {field}")
        for field, expected in {
            "url": URL,
            "manifest": f"{LATEST}/{module_id}.json",
            "download": f"{LATEST}/{module_id}.zip",
        }.items():
            if data.get(field) != expected:
                raise ValueError(f"{module_id}: invalid {field}")
        for field in ("esmodules", "scripts", "styles"):
            for filename in data.get(field, []):
                if not (path.parent / filename).is_file():
                    raise ValueError(f"{module_id}: missing {filename}")
        for pack in data.get("packs", []):
            if not (path.parent / pack["path"]).exists():
                raise ValueError(f"{module_id}: missing pack {pack['path']}")
        modules[module_id] = data
    if not modules:
        raise ValueError("No modules found")
    for module_id, data in modules.items():
        for dependency in data.get("relationships", {}).get("requires", []):
            dep_id = dependency["id"]
            if dep_id not in modules:
                raise ValueError(f"{module_id}: unknown dependency {dep_id}")
            if dependency.get("manifest") != f"{LATEST}/{dep_id}.json":
                raise ValueError(f"{module_id}: invalid manifest for {dep_id}")
    bundle = {dep["id"] for dep in modules["vtm5e-tools"]["relationships"]["requires"]}
    if bundle != modules.keys() - {"vtm5e-tools"}:
        raise ValueError("Bundle dependencies must include every other module")
    return modules


def build(tag, output):
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("Release tag must have the form v1.1.0 (stable releases only)")
    modules = read_modules()
    output = output.resolve()
    if output == ROOT or ROOT in output.parents and output.parts[len(ROOT.parts)].startswith("vtm5e-"):
        raise ValueError("Output must not overwrite a module directory")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Output directory must be empty to avoid stale release assets")
    release_url = f"{URL}/releases/download/{tag}"
    for module_id, data in modules.items():
        data["version"] = tag[1:]
        data["download"] = f"{release_url}/{module_id}.zip"
        for dep in data.get("relationships", {}).get("requires", []):
            dep["manifest"] = f"{release_url}/{dep['id']}.json"
        manifest = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        (output / f"{module_id}.json").write_text(manifest, encoding="utf-8")
        directory = ROOT / module_id
        with ZipFile(output / f"{module_id}.zip", "w", ZIP_DEFLATED) as archive:
            for path in sorted(directory.rglob("*")):
                if path.is_file() and path.name != "module.json":
                    archive.write(path, path.relative_to(directory).as_posix())
            archive.writestr("module.json", manifest)
            archive.write(ROOT / "LICENSE", "LICENSE")
    print(f"Built {len(modules)} manifests and {len(modules)} ZIPs in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Stable release tag, e.g. v1.1.0")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    if args.tag:
        build(args.tag, args.output)
    else:
        print(f"Validated {len(read_modules())} module manifests")
