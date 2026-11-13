#!/usr/bin/env python3
# Wires the town lots into the game's own tables from what build.py measured
# (tmp/eastbrook_houses/lots.json): each model's true height and largest dimension into every
# town record that stands it, and each walk-in model's room into the indoor camera's air.
# Nothing is typed by hand twice: run it after any lot rebuild.
#
#   python3 scripts/assets/eastbrook_houses/wire.py
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LOTS = json.load(open(os.path.join(ROOT, "tmp", "eastbrook_houses", "lots.json")))
# every file that writes a town building's measurements out by hand (the last rebuilds
# Fenbridge's records where the live-world document moved them, from its own copy)
RECORD_FILES = ("src/sim/eastbrook_layout.ts", "src/sim/fenbridge_layout.ts", "src/sim/highwatch_layout.ts", "src/sim/fenbridge_touchup.ts")
MODELS = "src/sim/painted_towns/models.ts"
AIR = "src/render/placed_town_interior_core.ts"
NUMBER = r"-?\d+(?:\.\d+)?"


def number(value):
    return repr(round(value, 4)).rstrip("0").rstrip(".") if "." in repr(round(value, 4)) else repr(round(value, 4))


def measured(text, lot):
    """One record's (or one table entry's) text with the lot's height and size written in."""
    text = re.sub(rf"(reach: \{{[^}}]*?height: ){NUMBER}", lambda m: m.group(1) + number(lot["height"]), text, count=1)
    size = f"modelSize: {number(lot['max_dim'])},"
    if re.search(rf"modelSize: {NUMBER},", text):
        return re.sub(rf"modelSize: {NUMBER},", size, text, count=1)
    return re.sub(rf"^(\s*)(doorX: {NUMBER},)$", lambda m: f"{m.group(1)}{m.group(2)}\n{m.group(1)}{size}", text, count=1, flags=re.M)


def records(path):
    full = os.path.join(ROOT, path)
    source = open(full).read()
    marks = [m for m in re.finditer(r"assetId: [`'][^`']*?/([a-z_]+)\.glb[`'],", source)]
    out, last, done = [], 0, 0
    for i, mark in enumerate(marks):
        lot = LOTS.get(mark.group(1))
        end = marks[i + 1].start() if i + 1 < len(marks) else len(source)
        # a record ends where its call does: never reach into the next one
        end = min(end, mark.end() + 1600)
        out.append(source[last : mark.end()])
        body = source[mark.end() : end]
        if lot and "reach:" in body:
            body = measured(body, lot)
            done += 1
        out.append(body)
        last = end
    out.append(source[last:])
    open(full, "w").write("".join(out))
    return done


def block(source, start):
    """The text of the `{ ... }` opening at `start`, braces matched."""
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    raise ValueError("unclosed block")


def table(path, opener, write):
    """Rewrites each lot's `  <name>: { ... }` entry inside the table that `opener` starts."""
    full = os.path.join(ROOT, path)
    source = open(full).read()
    at = source.index(opener)
    done = 0
    for name, lot in LOTS.items():
        found = re.compile(rf"\n  {name}: \{{").search(source, at, block(source, source.index("{", at + len(opener) - 1)))
        if not found:
            continue
        begin = found.start() + 1
        finish = block(source, source.index("{", begin))
        fresh = write(name, lot, source[begin:finish])
        if fresh is None:
            continue
        source = source[:begin] + fresh + source[finish:]
        done += 1
    open(full, "w").write(source)
    return done


def air_entry(name, lot, _old):
    air = lot.get("air")
    if not air:
        return None
    rows = "\n".join("      [" + ", ".join(number(v) for v in box) + "]," for box in air["boxes"])
    openings = ", ".join("{ box: %d, axis: %d, side: %d }" % (o["box"], o["axis"], o["side"]) for o in air["openings"])
    return (
        f"  {name}: {{\n"
        "    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the\n"
        "    // ceiling, then each doorway through its wall\n"
        f"    boxes: [\n{rows}\n    ],\n"
        f"    openings: [{openings}],\n"
        "  }"
    )


def main():
    for path in RECORD_FILES:
        print(path, records(path), "records")
    print(MODELS, table(MODELS, "export const PAINTED_MODELS", lambda _n, lot, old: measured(old, lot)), "models")
    print(AIR, table(AIR, "const MODEL_AIR", air_entry), "rooms")


main()
