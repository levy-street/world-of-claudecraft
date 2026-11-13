#!/usr/bin/env python3
# Stands the Eastbrook houses in the live world: writes each model's collision into
# data/asset_collision_overrides.json and each site in sites.json into the live-world
# touch-up document (data/world_touchup/current.map.json), then re-runs the three generators
# that own the artifacts built from them. Run it again after any rebuild or site change: the
# houses' own rows are replaced, nothing else in either file is touched.
#
#   python3 scripts/assets/eastbrook_houses/place.py [--remove]
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TMP = os.path.join(ROOT, "tmp", "eastbrook_houses")
OVERRIDES = os.path.join(ROOT, "data", "asset_collision_overrides.json")
TOUCHUP = os.path.join(ROOT, "data", "world_touchup", "current.map.json")
MODELS = os.path.join(ROOT, "public", "models", "eastbrook_houses")
PREFIX = "eastbrook_houses/"
# the town lots: one folder per colour set under the painted town models
TOWN = os.path.join(ROOT, "public", "models", "tidehold")
TOWN_SETS = "harbour"
REMOVE = "--remove" in sys.argv


def uid(name):
    return "eb" + hashlib.md5(("eastbrook_houses:" + name).encode()).hexdigest()[:10]


# The live world also stands a few of the old painted town models as plain placements. Each
# becomes the new lot of the same name in its town's colour set, at the same real size: a
# placement's scale is in multiples of the model's largest dimension, so it follows the new
# model's (the old ones are the release's measured sizes).
OLD_SETS = {"": "harbour", "fenrire": "harbour_moss", "highwatch": "harbour_alpine", "pantile": "harbour_pantile", "shakes": "harbour_shakes", "diamond": "harbour_diamond", "brick": "harbour_brick", "thatch": "harbour_thatch"}
OLD_SIZES = {"tavern_b": 30.262, "tavern": 22.648, "hall": 30.5, "bank": 22.6067, "shop_a": 16.28, "shop_b": 18.7, "smithy": 19.797, "house_a": 12.23, "house_b": 15.9799, "house_c": 19.58}


def restand(doc):
    lots = json.load(open(os.path.join(TMP, "lots.json")))
    for placement in doc["placements"]:
        parts = str(placement.get("assetId", "")).split("/")
        if parts[0] != "tidehold" or parts[-1] not in OLD_SIZES or len(parts) > 3:
            continue
        look = parts[1] if len(parts) == 3 else ""
        folder = OLD_SETS.get(look)
        if folder is None or not os.path.exists(os.path.join(TOWN, folder, parts[-1] + ".glb")):
            continue
        placement["assetId"] = f"tidehold/{folder}/{parts[-1]}"
        placement["scale"] = round(placement["scale"] * lots[parts[-1]]["max_dim"] / OLD_SIZES[parts[-1]], 4)
        print("restood", placement.get("name"), "as", placement["assetId"], "scale", placement["scale"])


# Scattered trees that grow INSIDE a hamlet building (a single-prop building is a decor
# record, which the scatter does not plant round): one through each of two Willowfen homes
# and one through a Galecrest croft. Each stands wholly inside its building's own collision
# circle, so clearing it changes nothing a walker or a spawn roll can reach.
INSIDE_BUILDINGS = ("tree2:-446.405:449.719", "tree2:-388.314:558.663", "tree:313.503:596.183")


def main():
    sites = [] if REMOVE else json.load(open(os.path.join(HERE, "sites.json")))
    models = sorted(f[:-4] for f in os.listdir(MODELS) if f.endswith(".glb"))
    overrides = json.load(open(OVERRIDES))
    for key in [k for k in overrides if k.startswith(PREFIX)]:
        del overrides[key]
    for model in models:
        table = os.path.join(TMP, "collision", f"{model}.json")
        if os.path.exists(table):
            overrides[PREFIX + model] = json.load(open(table))
    # every colour set of a town lot shares the geometry, so it shares the lot's rows
    for key in [k for k in overrides if k.startswith("tidehold/" + TOWN_SETS)]:
        del overrides[key]
    for folder in sorted(f for f in os.listdir(TOWN) if f.startswith(TOWN_SETS) and os.path.isdir(os.path.join(TOWN, f))):
        for file in sorted(os.listdir(os.path.join(TOWN, folder))):
            table = os.path.join(TMP, "lot_collision", file[:-4] + ".json")
            if file.endswith(".glb") and os.path.exists(table):
                overrides[f"tidehold/{folder}/{file[:-4]}"] = json.load(open(table))
    with open(OVERRIDES, "w") as f:
        json.dump(overrides, f, indent=2)
        f.write("\n")
    doc = json.load(open(TOUCHUP))
    restand(doc)
    mine = {uid(s["name"]) for s in json.load(open(os.path.join(HERE, "sites.json")))}
    doc["placements"] = [p for p in doc["placements"] if p.get("uid") not in mine and not str(p.get("assetId", "")).startswith(PREFIX)]
    wanted = set()
    for site in sites:
        doc["placements"].append(
            {
                "assetId": PREFIX + site["model"],
                "x": site["x"],
                "z": site["z"],
                "rotY": site["rotY"],
                "scale": site["scale"],
                # a site may stand on a town record that already collides for it. The mode is
                # what the sim reads first (map_doc.ts effectiveCollisionMode: an authored mode
                # wins over the flag), so a site that must not collide says "none" outright:
                # "baked" beside collide false still stood a second, larger box on the record's.
                "collide": site.get("collide", True),
                "uid": uid(site["name"]),
                "collisionMode": "baked" if site.get("collide", True) else "none",
                "y": site["y"],
                "name": site["label"],
            }
        )
        wanted.update(site.get("clear", []))
    wanted.update(INSIDE_BUILDINGS)
    marker = os.path.join(TMP, "cleared.json")
    before = set(json.load(open(marker))) if os.path.exists(marker) else set()
    kept = [k for k in doc.get("decorationExclusions", []) if k not in before]
    doc["decorationExclusions"] = kept + sorted(wanted - set(kept))
    os.makedirs(TMP, exist_ok=True)
    json.dump(sorted(wanted), open(marker, "w"))
    with open(TOUCHUP, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    commands = (
        ["node", "scripts/gen_asset_catalog.mjs"],
        ["node", "scripts/gen_collision_overrides.mjs"],
        # a changed town model moves the hash the touch-up is bound to: bump it first
        ["node", "scripts/assets/eastbrook_houses/touchup_rebase.mjs"],
        ["node", "scripts/world_touchup.mjs", "export", "data/world_touchup/current.map.json"],
        # both documents are kept in the repo formatter's layout, so their diff stays the rows added
        ["npx", "@biomejs/biome", "format", "--write", "data/asset_collision_overrides.json", "data/world_touchup/current.map.json"],
    )
    for command in commands:
        print("$", " ".join(command))
        subprocess.run(command, cwd=ROOT, check=True)
    print(f"{len(sites)} houses stand in the live world, {len(wanted)} trees and rocks cleared")


main()
