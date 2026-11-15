"""Generate coordinate-bound evidence using the released ice checkpoint, never PRO labels."""

import argparse
import hashlib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "pipeline/cache/ice"
MODEL = "nasa-ibm-ai4science/Ice-Prospectivity-NASA-IBM-Lunar-Foundation-Model"
MODEL_REV = "fb0510d0d676ae7bfae9acd88219b05449c769ee"
DATA = "nasa-ibm-ai4science/Sombench-Ice-Prospectivity-Regression"
DATA_REV = "78040503ceaa68107829f48114774112e8ee940d"
BASE = "nasa-ibm-ai4science/NASA-IBM-Lunar-Foundation-Model"
BASE_REV = "b657bdfe6fc4c0445d918f77a2d7b919805f3bce"
LAYERS = {
    "aspect": "ASP_SIN_COS",
    "CUR": "CUR",
    "DICE": "DICE",
    "LPSR": "LPSR",
    "LPSR_DEN": "LPSR_DEN",
    "LPSR_DIS": "LPSR_DIS",
    "slope": "SLOPE",
    "TMAX": "TMAX",
}


def download(repo, revision, name, target, dataset=False):
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    prefix = "datasets/" if dataset else ""
    url = f"https://huggingface.co/{prefix}{repo}/resolve/{revision}/{name}"
    temp = target.with_suffix(target.suffix + ".part")
    with urlopen(url, timeout=120) as response, temp.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temp.replace(target)
    return target


def data_file(name):
    return download(DATA, DATA_REV, name, CACHE / "data" / name, True)


def sites():
    text = (ROOT / "web/src/sites.ts").read_text()
    pattern = r"slug: '([^']+)'.*?lat: ([\d.-]+),.*?lon_e: ([\d.-]+),"
    return [
        {"slug": s, "lat": float(a), "lonE": float(b)}
        for s, a, b in re.findall(pattern, text, re.S)
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--device", choices=["cpu", "mps", "cuda"], default="cpu")
    args = parser.parse_args()
    os.environ.setdefault("MPLCONFIGDIR", str(CACHE / "matplotlib"))
    import numpy as np
    import rasterio
    from pyproj import CRS, Transformer

    catalog = download(DATA, DATA_REV, "README.md", CACHE / "data/README.md", True)
    assert catalog.exists()
    with urlopen(
        f"https://huggingface.co/api/datasets/{DATA}/revision/{DATA_REV}", timeout=60
    ) as response:
        files = json.load(response)["siblings"]
    names = sorted(f["rfilename"] for f in files if f["rfilename"].endswith("_S_80S_SLOPE.tif"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        slopes = list(pool.map(data_file, names))
    selected = []
    for site in sites():
        if not -90 <= site["lat"] <= -80:
            continue
        for path in slopes:
            with rasterio.open(path) as src:
                # Use the raster's lunar datum, not terrestrial EPSG:4326.
                crs = CRS(src.crs)
                x, y = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(
                    site["lonE"], site["lat"]
                )
                row, col = src.index(x, y)
                if 0 <= row < src.height and 0 <= col < src.width:
                    patch = path.name.removesuffix("_SLOPE.tif")
                    selected.append({**site, "patch": patch, "row": row, "col": col})
                    break
    for patch in sorted({s["patch"] for s in selected}):
        for suffix in LAYERS.values():
            data_file(f"{patch}_{suffix}.tif")
    print(json.dumps(selected, indent=2), flush=True)
    (CACHE / "selected.json").write_text(json.dumps(selected, indent=2))
    if args.prepare_only:
        return

    import torch
    import yaml
    from terratorch_integration import LunarPixelwiseRegressionTask

    torch.set_num_threads(4)
    config_path = download(MODEL, MODEL_REV, "config.yaml", CACHE / "model/config.yaml")
    backbone = download(BASE, BASE_REV, "backbone/config.yaml", CACHE / "model/backbone.yaml")
    weights = download(
        MODEL, MODEL_REV, "ni_lfm_ps8_all_modalities_s42.ckpt", CACHE / "model/model.ckpt"
    )
    config = yaml.safe_load(config_path.read_text())
    init = config["model"]["init_args"]
    init["model_args"]["backbone_checkpoint_path"] = None
    init["model_args"]["backbone_cfg"] = str(backbone)
    task = LunarPixelwiseRegressionTask(**init)
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
    task.load_state_dict(checkpoint["state_dict"], strict=True)
    del checkpoint
    task.eval().to(args.device)
    data_config = config["data"]["init_args"]
    results = []
    splits = {
        split: set(data_file(f"{split}_filtered.txt").read_text().split())
        for split in ("train", "val", "test")
    }
    for patch in sorted({s["patch"] for s in selected}):
        inputs = {}
        valid = np.ones((256, 256), dtype=bool)
        grid = None
        hashes = {}
        for modality, suffix in LAYERS.items():
            path = data_file(f"{patch}_{suffix}.tif")
            hashes[suffix] = hashlib.sha256(path.read_bytes()).hexdigest()
            with rasterio.open(path) as src:
                current = (src.crs, src.transform, src.width, src.height)
                if grid is not None and current != grid:
                    raise ValueError(f"Unaligned input: {path}")
                grid = current
                raw = src.read(masked=True).astype("float32").filled(np.nan)
            if raw.shape != (len(data_config["means"][modality]), 256, 256):
                raise ValueError(f"Unexpected input shape: {path}: {raw.shape}")
            valid &= np.isfinite(raw).all(axis=0)
            # Match official no_data_replace=0, then channel-wise normalization.
            raw = np.where(np.isfinite(raw), raw, 0)
            means = np.asarray(data_config["means"][modality], dtype="float32")[:, None, None]
            stds = np.asarray(data_config["stds"][modality], dtype="float32")[:, None, None]
            inputs[modality] = torch.from_numpy((raw - means) / stds)[None].to(args.device)
        with torch.inference_mode():
            prediction = task.model(inputs).output.squeeze().cpu().numpy()
        if prediction.shape != (256, 256):
            raise ValueError(f"Unexpected output shape: {prediction.shape}")
        for site in (s for s in selected if s["patch"] == patch):
            row, col = site["row"], site["col"]
            value = float(prediction[row, col])
            ok = bool(valid[row, col]) and np.isfinite(value) and 0 <= value <= 1
            results.append(
                {
                    **site,
                    "status": "ok" if ok else "no-data",
                    "score": round(value, 6) if ok else None,
                    "datasetSplit": next((k for k, v in splits.items() if patch in v), "unlisted"),
                    "inputSha256": hashes,
                    "validInputFraction": round(float(valid.mean()), 6),
                }
            )
        print(f"Inferred {patch}", flush=True)
    evidence = {
        "schemaVersion": 1,
        "model": MODEL,
        "modelRevision": MODEL_REV,
        "dataset": DATA,
        "datasetRevision": DATA_REV,
        "generatedAt": datetime.now(UTC).isoformat(),
        "resolutionM": 240,
        "method": "checkpoint-inference",
        "codeRevision": "d54c67aad513cb9daca444afa425cfb278e4fbf8",
        "device": args.device,
        "torchVersion": torch.__version__,
        "sites": results,
    }
    with weights.open("rb") as source:
        evidence["checkpointSha256"] = hashlib.file_digest(source, "sha256").hexdigest()
    output = ROOT / "web/public/evidence/ice.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".json.part")
    temp.write_text(json.dumps(evidence, indent=2, allow_nan=False) + "\n")
    temp.replace(output)
    print(f"Wrote {output}", flush=True)


if __name__ == "__main__":
    main()
