#!/usr/bin/env python3
"""Classify diff3 conflict hunks so only the ones needing judgment get hand-resolved.

PURE_ADD  both sides only ADD lines at the same anchor (base is a subsequence of each,
          with no base line dropped). A line-union is behavior-preserving.
MODIFIED  at least one side changed or dropped a base line. Needs a human.
"""
import re
import sys

START = re.compile(r'^<<<<<<< ')
BASE = re.compile(r'^\|\|\|\|\|\|\| ')
MID = re.compile(r'^=======$')
END = re.compile(r'^>>>>>>> ')


def hunks(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    i = 0
    while i < len(lines):
        if not START.match(lines[i]):
            i += 1
            continue
        i += 1
        ours, base, theirs = [], [], []
        bucket = ours
        while i < len(lines) and not END.match(lines[i]):
            if BASE.match(lines[i]):
                bucket = base
            elif MID.match(lines[i]):
                bucket = theirs
            else:
                bucket.append(lines[i])
            i += 1
        i += 1
        yield ours, base, theirs


def keeps_base(side, base):
    """Is every base line still present, in order, on this side?"""
    it = iter(side)
    return all(any(line == candidate for candidate in it) for line in base)


def classify(path):
    pure, modified = 0, 0
    for ours, base, theirs in hunks(path):
        if keeps_base(ours, base) and keeps_base(theirs, base):
            pure += 1
        else:
            modified += 1
    return pure, modified


if __name__ == '__main__':
    total_pure = total_mod = 0
    for p in sys.argv[1:]:
        try:
            pure, mod = classify(p)
        except Exception as exc:  # noqa: BLE001
            print(f'{p}: ERROR {exc}')
            continue
        total_pure += pure
        total_mod += mod
        flag = 'MANUAL' if mod else 'auto'
        print(f'{flag:7} pure={pure} modified={mod}  {p}')
    print(f'\ntotals: pure_add={total_pure} modified={total_mod}')
