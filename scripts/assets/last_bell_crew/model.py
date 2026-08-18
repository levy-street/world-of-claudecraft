"""Blender entry point for The Last Bell cast.

Run by hand, never from `npm run build`, exactly like the other exporters here:

    blender --background --python scripts/assets/last_bell_crew/model.py

Environment:
  CREW_MEMBER   member id from `crew.CREW`, or `all` (default `all`)
  CREW_OUT      directory for the raw GLBs (skipped when unset)
  CREW_PLATES   directory for the concept-book plates (skipped when unset)
  CREW_FROM_SHIPPED  0 to render plates from an in-memory build instead of
                the shipped GLB (look-dev only; the book normally photographs
                what actually shipped)

Mirrors `scripts/assets/warden_hale_statue/model.py`: the factory is Python under
Blender because re-posing and re-skinning a rigged KayKit body needs an armature
evaluator the browser/three export path does not have.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (must follow the path insert)

import cast  # noqa: E402
import crew  # noqa: E402
import figures  # noqa: E402
import plates  # noqa: E402
import weapons  # noqa: E402

MEMBER = os.environ.get("CREW_MEMBER", "all")
OUT = os.environ.get("CREW_OUT")
PLATES_DIR = os.environ.get("CREW_PLATES")
# Photograph the shipped GLB by default; set 0 for a look-dev loop before export.
FROM_SHIPPED = os.environ.get("CREW_FROM_SHIPPED", "1") != "0"

members = list(cast.CAST) if MEMBER == "all" else MEMBER.split(",")
report = {}

for member in members:
    if member not in figures.RECIPES:
        raise SystemExit(f"unknown cast member: {member}")

    # EXPORT FIRST, then photograph. The book renders the shipped GLB (see
    # `plates.render_member`), so exporting in the same run is what keeps a plate
    # honest about the file the game loads.
    if OUT and cast.CAST[member].get("kind") in (None, "spawn"):
        crew.wipe()
        seed = crew.seed_context()
        figures.RECIPES[member]()
        bpy.data.objects.remove(seed, do_unlink=True)
        report[member] = crew.measure()

        # A figure whose weapon is BESPOKE ships that weapon as its own GLB too,
        # exported BEFORE the body so it survives whatever `crew.export` drops.
        for spec in cast.CAST[member].get("weapons", []):
            if not spec.get("built_in"):
                continue
            prop = next((o for o in bpy.data.objects
                         if o.name.startswith("Prop_")
                         and o.name.endswith(os.path.basename(spec["url"])[:-4])), None)
            if prop is None:
                raise SystemExit(f"{member}: built-in weapon {spec['url']} was never mounted")
            # Keep the spec's OWN subpath (`weapons/marsh_halberd.glb`) rather than
            # flattening to the basename. A weapon and a body do not ship to the same
            # place, and flattening quietly put the halberd in the NPC body directory,
            # from where it was never copied into `public/models/weapons/`: the game
            # went on attaching the SHARED halberd, star-glass petals and all, to the
            # one man whose whole characterisation is that his kit is cheap.
            wpath = os.path.join(OUT, *spec["url"].split("/"))
            weapons.export(prop, wpath)
            report[member].setdefault("weapons", []).append(wpath)

        path = os.path.join(OUT, f"{member}.glb")
        crew.export(path)
        report[member]["out"] = path
        report[member]["bytes"] = os.path.getsize(path)

    if PLATES_DIR:
        entry = plates.render_member(member, PLATES_DIR, from_shipped=FROM_SHIPPED)
        report.setdefault(member, {})
        report[member]["tris"] = entry["stats"]["tris"]
        report[member]["plates"] = len(entry["plates"])
        report[member]["photographed"] = entry["stats"]["source"]

    if member not in report:
        crew.wipe()
        seed = crew.seed_context()
        figures.RECIPES[member]()
        bpy.data.objects.remove(seed, do_unlink=True)
        report[member] = crew.measure()

print("STATS " + json.dumps(report))
