import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { idleVariantCadenceForTest } from '../src/render/characters/visual';

const repoRoot = path.resolve(__dirname, '..');

/** Clip name -> duration (seconds), read straight out of a GLB's accessors. */
function clipDurations(glbRelative: string): Map<string, number> {
  const buf = readFileSync(path.join(repoRoot, 'public', glbRelative));
  let offset = 12;
  let json: any = null;
  let bin: Buffer | null = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    offset += 8 + len;
    if (len % 4) offset += 4 - (len % 4);
  }
  const out = new Map<string, number>();
  for (const anim of json.animations ?? []) {
    let end = 0;
    for (const sampler of anim.samplers) {
      const acc = json.accessors[sampler.input];
      if (acc.max?.[0] != null) {
        end = Math.max(end, acc.max[0]);
        continue;
      }
      const view = json.bufferViews[acc.bufferView];
      const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) end = Math.max(end, bin!.readFloatLE(base + i * 4));
    }
    out.set(anim.name, end);
  }
  return out;
}

/** Every manifest rig that declares idle-breakers. */
const rigsWithVariants = Object.entries(VISUALS).filter(
  ([, def]) => (def.clips.idleVariants ?? []).length > 0,
);

describe('idle-breaker clips', () => {
  it('is a feature at least one rig actually uses', () => {
    expect(rigsWithVariants.map(([key]) => key)).toContain('mount_chimeglass_tortoise');
  });

  it('names only clips the shipped GLB really carries', () => {
    for (const [key, def] of rigsWithVariants) {
      const durations = clipDurations(def.url.replace(/^\//, ''));
      for (const name of def.clips.idleVariants ?? []) {
        expect(durations.has(name), `${key} declares a missing idle variant: ${name}`).toBe(true);
      }
      // and the base idle it hands back to
      expect(durations.has(def.clips.idle), `${key} is missing its base idle`).toBe(true);
    }
  });

  it('fires a fidget on the authored 5-second beat, clear of the previous one', () => {
    // The fidgets are this rig's character, so the cadence is deliberately
    // tight: a fidget falls due every 5 seconds. The only hard requirement left
    // is that a variant has ENDED before the next one is due, since a fidget is
    // a one-shot and re-firing over a live one would cut it short.
    const { min, jitter } = idleVariantCadenceForTest;
    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(min).toBe(5);
    for (const [key, def] of rigsWithVariants) {
      const durations = clipDurations(def.url.replace(/^\//, ''));
      const longest = Math.max(
        ...(def.clips.idleVariants ?? []).map((name) => durations.get(name) ?? 0),
      );
      expect(longest, `${key} has a zero-length idle variant`).toBeGreaterThan(0);
      expect(min, `${key}: fidget beat ${min}s vs longest clip ${longest}s`).toBeGreaterThan(
        longest,
      );
    }
  });
});
