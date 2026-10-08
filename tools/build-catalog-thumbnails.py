"""Build small static previews from immutable public catalog images.

Usage: python tools/build-catalog-thumbnails.py /path/to/storefront-state.json
Original media, product records, orders and stock are never written.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import sys
import subprocess
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
state = json.loads(Path(sys.argv[1]).read_text())["state"]
sources = set()
for product in state["products"]:
    images = list(dict.fromkeys(str(value or "").strip() for value in product.get("images", [])))
    real = [value for value in images if value and "photo-1523275335684-37898b6baf30" not in value]
    images = real or [value for value in images if value]
    primary = next(iter(images), "") or next((row.get("image", "") for row in product.get("variants", []) if row.get("image")), "")
    if primary.startswith("/api/media/media/product/"):
        sources.add(primary)
output = root / "public/catalog-thumbnails"
output.mkdir(parents=True, exist_ok=True)

def build_preview(source):
    try:
        original = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--max-time", "30", "https://orastore.com.lk" + source], check=True, capture_output=True).stdout
        if len(original) > 5_000_000:
            raise ValueError("Image exceeds thumbnail input limit")
        with Image.open(io.BytesIO(original)) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((480, 480), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            digest = hashlib.sha256(b"ora-thumb-480-webp82-v1:" + original).hexdigest()[:24]
            target = output / (digest + ".webp")
            image.save(target, "WEBP", quality=82, method=6)
        return source, "/catalog-thumbnails/" + target.name, len(original), target.stat().st_size
    except Exception as error:
        print("Original retained for", source, ":", type(error).__name__, flush=True)
        return None

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = []
    for result in pool.map(build_preview, sorted(sources)):
        if result:
            results.append(result)
        print("Previews processed:", len(results), "/", len(sources), flush=True)
manifest = {source: preview for source, preview, _, _ in results}
(root / "src/data/catalogThumbnails.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
print(json.dumps({"previews": len(results), "original_bytes": sum(row[2] for row in results), "preview_bytes": sum(row[3] for row in results)}), flush=True)
