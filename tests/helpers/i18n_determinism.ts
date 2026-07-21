// Shared determinism gate for the i18n generators (lazy-locales artifact/CI/determinism hygiene).
//
// `assertDeterministic` runs an i18n generator script TWICE, each time into its
// own throwaway temp directory via the script's `I18N_OUT_DIR` override (honored
// by scripts/i18n_build.mjs, scripts/i18n_admin_build.mjs, and scripts/i18n_scan.mjs),
// and asserts the emitted files are byte-identical across the two runs.
//
// It replaces the committed-bytes `git diff` freshness check for the now-gitignored
// src/ui/i18n.status.json (there are no committed bytes left to diff), and ADDS a
// stronger guarantee for the still-committed resolved directories (which keep their
// `git diff` freshness check too): a generator that is accidentally non-deterministic
// must make this THROW.
//
// To surface a hidden locale / timezone / output-path dependency in the emit that a
// same-machine "run it twice" check would miss, the two runs are deliberately
// PERTURBED: different TZ, different LC_ALL/LANG, and different temp-dir paths. The
// Node binary is PINNED to the one running the test suite (process.execPath) and the
// working directory to the repo root, so both runs share the same lockfile /
// node_modules / esbuild context (the generators bundle the TS source with esbuild).
//
// Dependency-free on purpose: node:child_process / node:fs / node:os / node:path only.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface DeterminismCheck {
  /** Absolute path to the generator script (an .mjs that honors I18N_OUT_DIR). */
  script: string;
  /**
   * File names (relative to I18N_OUT_DIR) to compare byte-for-byte. Omit to compare
   * EVERY file the script emits into I18N_OUT_DIR (recursively) - used for the
   * directory generators (i18n_build / i18n_admin_build).
   */
  outFiles?: string[];
  /** Extra environment shared by both runs (the perturbed vars are layered on top). */
  env?: Record<string, string>;
  /** Working directory for the generator (defaults to the repo root = process.cwd()). */
  cwd?: string;
}

// The two perturbed environments. Distinct timezone, locale, and temp-dir prefix so
// a hidden dependency on any of them produces a diff instead of a false pass.
const PERTURBATIONS = [
  { TZ: "UTC", LC_ALL: "C", LANG: "C", prefix: "i18n-det-a-" },
  { TZ: "Asia/Kolkata", LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8", prefix: "zzz-i18n-det-b-" },
] as const;

// Every file under `dir`, as paths relative to `dir`, sorted for a stable order.
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const childRel = rel ? path.join(rel, name) : name;
      if (statSync(path.join(dir, childRel)).isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  walk("");
  return out.sort();
}

function generateInto(check: DeterminismCheck, dir: string, perturb: (typeof PERTURBATIONS)[number]): void {
  execFileSync(process.execPath, [check.script], {
    cwd: check.cwd ?? process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...check.env,
      I18N_OUT_DIR: dir,
      TZ: perturb.TZ,
      LC_ALL: perturb.LC_ALL,
      LANG: perturb.LANG,
    },
  });
}

/**
 * Generate twice into perturbed throwaway temp dirs and assert byte-identity.
 * Throws on a real determinism bug (a diff, a missing file, or a differing file set).
 */
export function assertDeterministic(check: DeterminismCheck): void {
  const dirs: string[] = [];
  const captured: Array<{ files: string[]; bytes: Map<string, Buffer> }> = [];
  try {
    for (const perturb of PERTURBATIONS) {
      const dir = mkdtempSync(path.join(tmpdir(), perturb.prefix));
      dirs.push(dir);
      generateInto(check, dir, perturb);

      const files = check.outFiles ?? listFilesRecursive(dir);
      const bytes = new Map<string, Buffer>();
      for (const f of files) {
        const p = path.join(dir, f);
        if (!existsSync(p)) {
          throw new Error(
            `assertDeterministic: ${check.script} did not emit "${f}" into ${dir} ` +
              `(TZ=${perturb.TZ} LC_ALL=${perturb.LC_ALL}).`,
          );
        }
        bytes.set(f, readFileSync(p));
      }
      captured.push({ files: check.outFiles ? files : files.slice().sort(), bytes });
    }
  } finally {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // Best-effort temp cleanup; a leaked temp dir must never fail the gate.
      }
    }
  }

  const [a, b] = captured;
  // When comparing the whole emitted tree, the file SET must match too (a dropped or
  // extra file between runs is itself a determinism bug).
  if (!check.outFiles) {
    const setA = a.files.join("\n");
    const setB = b.files.join("\n");
    if (setA !== setB) {
      throw new Error(
        `assertDeterministic: ${check.script} emitted a different file set across two ` +
          `perturbed-env runs.\n  run A: ${a.files.join(", ")}\n  run B: ${b.files.join(", ")}`,
      );
    }
  }

  const names = check.outFiles ?? a.files;
  for (const f of names) {
    const ba = a.bytes.get(f)!;
    const bb = b.bytes.get(f)!;
    if (!ba.equals(bb)) {
      throw new Error(
        `assertDeterministic: ${check.script} produced a non-byte-identical "${f}" across ` +
          `two perturbed-env runs (TZ / LC_ALL / temp-path differed). This is a real ` +
          `determinism bug, not a re-baseline.`,
      );
    }
  }
}
