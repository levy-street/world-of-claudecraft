"""Blender entry point for The Last Bell cast.

Run by hand, never from `npm run build`, exactly like the other exporters here:

    blender --background --python scripts/assets/last_bell_crew/model.py

Environment:
  CREW_MEMBER   member id from `crew.CREW`, or `all` (default `all`)
  CREW_OUT      directory for the raw GLBs (skipped when unset)
  CREW_PLATES   directory for the concept-book plates (skipped when unset)

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

MEMBER = os.environ.get("CREW_MEMBER", "all")
OUT = os.environ.get("CREW_OUT")
PLATES_DIR = os.environ.get("CREW_PLATES")

members = list(cast.CAST) if MEMBER == "all" else MEMBER.split(",")
report = {}

for member in members:
    if member not in figures.RECIPES:
        raise SystemExit(f"unknown cast member: {member}")

    if PLATES_DIR:
        # plate rendering builds the figure itself, so reuse that scene
        entry = plates.render_member(member, PLATES_DIR)
        report[member] = {"tris": entry["stats"]["tris"], "plates": len(entry["plates"])}
    else:
        crew.wipe()
        seed = crew.seed_context()
        figures.RECIPES[member]()
        bpy.data.objects.remove(seed, do_unlink=True)
        report[member] = crew.measure()

    # The crew AND the repainted break-spawned export shipping GLBs. The two
    # baked-texture bodies (`kind: creature`) keep their existing models and are
    # re-coloured at runtime by the entity tint the sim already gives them.
    if OUT and cast.CAST[member].get("kind") in (None, "spawn"):
        path = os.path.join(OUT, f"{member}.glb")
        crew.export(path)
        report[member]["out"] = path
        report[member]["bytes"] = os.path.getsize(path)

print("STATS " + json.dumps(report))
