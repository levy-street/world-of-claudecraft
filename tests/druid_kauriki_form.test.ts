import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The druid tank form is the Kauriki, a hulking white kiwi on a Tripo biped rig,
// replacing the purpose-built bear quadruped. These pin the shipped GLBs against
// the manifest wiring: a clip the ClipMap names but the asset does not carry
// fails silently at runtime as a frozen bind pose, which no other test catches.
const ROOT = join(__dirname, '..');
const BODY = 'public/models/creatures/kauriki_form.glb';
const ANIMS = 'public/models/creatures/kauriki_form_anims.glb';

/** The JSON chunk of a binary glTF. */
function glbJson(rel: string): {
  animations?: { name?: string; samplers?: { input: number }[] }[];
  accessors?: { max?: number[] }[];
} {
  const b = readFileSync(join(ROOT, rel));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

/** Longest sampler input on a clip, which is its duration in seconds. glTF
 *  requires min/max on animation input accessors, so this needs no bin chunk. */
function clipDuration(doc: ReturnType<typeof glbJson>, name: string): number {
  const anim = (doc.animations ?? []).find((a) => a.name === name);
  if (!anim) throw new Error('no clip named ' + name);
  let max = 0;
  for (const s of anim.samplers ?? []) {
    const acc = (doc.accessors ?? [])[s.input];
    const t = acc?.max?.[0] ?? 0;
    if (t > max) max = t;
  }
  return max;
}

describe('druid Kauriki tank form', () => {
  it('ships both halves of the asset', () => {
    expect(existsSync(join(ROOT, BODY)), BODY).toBe(true);
    expect(existsSync(join(ROOT, ANIMS)), ANIMS).toBe(true);
  });

  it('the clip donor carries every clip the ClipMap names', () => {
    const names = (glbJson(ANIMS).animations ?? []).map((a) => a.name);
    for (const clip of [
      'Kauriki_Idle',
      'Kauriki_Walk',
      'Kauriki_Run',
      'Kauriki_Haka',
      'Kauriki_Hit',
      'Kauriki_Death',
      'Kauriki_Jump',
    ]) {
      expect(names, clip).toContain(clip);
    }
  });

  it('drops the haka into the swing slot the bear attack occupied', () => {
    // Authored to 0.783s against the bear form's Attack, which the VisualDef
    // plays at attackTimeScale 1. Drift here desyncs the hit from the swing.
    const d = clipDuration(glbJson(ANIMS), 'Kauriki_Haka');
    expect(d).toBeGreaterThan(0.7);
    expect(d).toBeLessThan(0.86);
  });

  it('wires form_bear to the Kauriki body and its clip donor', () => {
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const start = src.indexOf('  form_bear: {');
    expect(start, 'form_bear VisualDef').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('  },', start));
    expect(block).toContain('kauriki_form.glb');
    expect(block).toContain('kauriki_form_anims.glb');
    expect(block).toContain('clips: KAURIKI_FORM');
    // Tripo bipeds face +X; character visuals face +Z at world facing 0.
    expect(block).toContain('yaw: -Math.PI / 2');
    expect(block).toContain('attackTimeScale: 1');
    expect(block).not.toContain('bear_form.glb');
  });

  it('keeps the tank ClipMap free of cast, emote and per-ability attacks', () => {
    // Load-bearing omission inherited from the bear: tank abilities are instant,
    // and naming a `cast` clip here makes an instant cast fire a swing. The rig
    // does carry a retargeted Cast clip, which is why this has to be asserted
    // rather than assumed from the asset.
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const start = src.indexOf('const KAURIKI_FORM: ClipMap = {');
    expect(start, 'KAURIKI_FORM ClipMap').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('};', start));
    expect(block).toContain("attack: ['Kauriki_Haka']");
    expect(block).toContain("swim: 'Kauriki_Walk'");
    expect(block).not.toContain('cast:');
    expect(block).not.toContain('emote:');
    expect(block).not.toContain('attackByAbility');
    // The rig ships no Land or Sit, so neither may be named.
    expect(block).not.toContain('land:');
    expect(block).not.toContain('sitIdle:');
  });

  it('leaves the retargeted Cast clip in the asset but unreferenced', () => {
    const names = (glbJson(ANIMS).animations ?? []).map((a) => a.name);
    expect(names).toContain('Kauriki_Cast');
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    expect(src).not.toContain("'Kauriki_Cast'");
  });
});

// The cast apparition rises a moment BEFORE the caster's own body morphs, so a
// spirit that disagrees with the form reads as the wrong spell entirely.
describe('druid tank cast apparition', () => {
  const specLine = (id: string): string => {
    const src = readFileSync(join(ROOT, 'src/render/ability_vfx_full_specs.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.startsWith(`  ${id}: `));
    if (!line) throw new Error('no spec for ' + id);
    return line;
  };

  it('registers the Kauriki as its own spirit species', () => {
    const src = readFileSync(join(ROOT, 'src/render/ability_vfx/spirits.ts'), 'utf8');
    expect(src).toContain("kauriki: 'models/creatures/kauriki_form.glb',");
    // Height and tempo are keyed by species; a missing entry silently falls back
    // and the apparition comes out the wrong size or speed.
    expect(src).toMatch(/kauriki: 2\.5,/);
    expect(src).toMatch(/kauriki: 0\.85,/);
  });

  it('conjures the Kauriki for both tank abilities', () => {
    for (const id of ['bear_form', 'bear_charge']) {
      expect(specLine(id), id).toContain('"model":"kauriki"');
      expect(specLine(id), id).not.toContain('"model":"bear"');
      // The bear tint is a brown pelt read; this form is white.
      expect(specLine(id), id).not.toContain('"tint":"#b97a45"');
    }
  });

  it('leaves moonkin_form on the bear silhouette it deliberately borrows', () => {
    expect(specLine('moonkin_form')).toContain('"model":"bear"');
    const src = readFileSync(join(ROOT, 'src/render/ability_vfx/spirits.ts'), 'utf8');
    expect(src).toContain("bear: 'models/creatures/bear_form.glb',");
  });

  it('ships the clips the spirit puppet looks for by name', () => {
    // The puppet resolves Idle/Run/Attack off the BODY glb, not the clip donor,
    // so the retargeted preset names have to survive in kauriki_form.glb.
    const names = (glbJson(BODY).animations ?? []).map((a) => a.name);
    for (const clip of ['Idle', 'Run', 'Attack']) {
      expect(names, clip).toContain(clip);
    }
  });
});
