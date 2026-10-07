"""Package only runtime files; no dependencies or test fixtures are distributed."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
manifest = json.loads((extension / "manifest.json").read_text())
output = root / "artifacts" / f"facebook-sponsored-hider-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(extension.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(extension))
print(output)
