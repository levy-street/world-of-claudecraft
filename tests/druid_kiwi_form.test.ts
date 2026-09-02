import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { catBody } from '../src/render/characters/form_visual_selection_core';
import { VISUALS } from '../src/render/characters/manifest';
import { CAT_FORM_SWING_SPEED } from '../src/sim/combat/form_swing';
import { ABILITIES } from '../src/sim/content/classes';

interface GlbAnimation {
  name?: string;
  samplers?: { input: number }[];
}

const publicPath = (url: string): string =>
  fileURLToPath(new URL(`../public/${url.replace(/^\//, '')}`, import.meta.url));

// The druid feral form used to BE the shaman's wolf: one VisualDef served both.
// Splitting them is the whole point of the kiwi, so these guards pin the split
// rather than just the existence of a new def.
describe('Druid Kiwi Form body', () => {
  it('gives the feral form its own kiwi rig, not the wolf', () => {
    expect(VISUALS.form_kiwi?.url).toBe('models/creatures/kiwi_form.glb');
    expect(VISUALS.form_kiwi?.url).not.toBe(VISUALS.form_cat?.url);
    // No tint: the kiwi ships its own plumage. The wolf's tawny lerp existed only
    // to separate the druid from grey pack wolves, and would muddy this texture.
    expect(VISUALS.form_kiwi?.tint).toBeUndefined();
  });

  it('keeps the wolf rig for the shaman Shadewolf', () => {
    expect(VISUALS.form_cat?.url).toBe('models/creatures/wolf_basic.glb');
    expect(VISUALS.form_cat?.tint).toBe(0xd08b45);
  });

  it('yaws the Tripo biped from +X onto the game facing-0 convention', () => {
    // Off by a quarter turn and the form runs sideways; 0 or undefined is the bug.
    expect(VISUALS.form_kiwi?.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('ships the GLB and registers it in the media manifest', () => {
    expect(existsSync(publicPath('models/creatures/kiwi_form.glb'))).toBe(true);
    expect(MEDIA_ASSETS['models/creatures/kiwi_form.glb']).toMatch(
      /^\/media\/models\/creatures\/kiwi_form[.][0-9a-f]+[.]glb$/,
    );
  });

  it('preloads at boot like the other shapeshift bodies', () => {
    // A lazyPreload form pops in a frame late on the first shift of a session.
    expect(VISUALS.form_kiwi?.lazyPreload).toBeUndefined();
  });
});

describe('cat slot body selection', () => {
  it('gives the druid feral form the kiwi and the Shadewolf the wolf', () => {
    expect(catBody(false)).toBe('form_kiwi');
    expect(catBody(true)).toBe('form_cat');
  });
});

describe('Kiwi Form ability copy', () => {
  const FERAL_IDS = ['cat_form', 'prowl', 'rake', 'claw', 'ferocious_bite', 'rip', 'tigers_fury'];

  it('names the form toggle after the body it grants', () => {
    expect(ABILITIES.cat_form.name).toBe('Kiwi Form');
    expect(ABILITIES.cat_form.description).toContain('Shapeshift into a kiwi');
  });

  it('leaves no druid ability still telling the player it is a wolf', () => {
    const stale: string[] = [];
    for (const ability of Object.values(ABILITIES)) {
      if (ability.class !== 'druid') continue;
      const text = `${ability.name} ${ability.description ?? ''}`;
      if (/wolf/i.test(text)) stale.push(ability.id);
    }
    expect(stale, `druid abilities still naming a wolf: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps the form gate on every ability that names Kiwi Form', () => {
    // The copy and the mechanic have to agree: a description that says "Kiwi Form
    // only" while requiresForm is unset would lie to the player.
    for (const id of FERAL_IDS) {
      const ability = ABILITIES[id];
      expect(ability, `missing feral ability ${id}`).toBeTruthy();
      if (id === 'cat_form') continue;
      expect(ability.requiresForm, `${id} form gate`).toBe('cat');
      expect(ability.description, `${id} copy`).toContain('Kiwi Form');
    }
  });

  it('does not rename the shaman Shadewolf along with it', () => {
    expect(ABILITIES.ghost_wolf.name).toBe('Shadewolf');
    expect(ABILITIES.ghost_wolf.class).toBe('shaman');
  });
});

// The rig arrived from the asset pipeline with a generic `preset:biped:slash`
// retarget: a 6.6-second arm swing on a body with no arms, which only read as an
// attack because the VisualDef played it at 6.6x. scripts/build_kiwi_peck_anim.mjs
// authors a real peck off the rig's own donor poses; these pin that wiring.
describe('Kiwi Form peck clip', () => {
  const ANIMS_URL = 'models/creatures/kiwi_form_anims.glb';

  /** Clip names out of a GLB's JSON chunk, dependency-free (the pattern
   *  tests/character_clipmaps.test.ts uses, so the gate cannot be fooled by
   *  whatever the runtime loader stack does). */
  function glbClips(url: string): { names: string[]; meshes: number; durations: number[] } {
    const buf = readFileSync(publicPath(url));
    expect(buf.readUInt32LE(0), `${url} magic`).toBe(0x46546c67);
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32LE(offset);
      if (buf.readUInt32LE(offset + 4) === 0x4e4f534a) {
        const json = JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + length));
        const accessors = json.accessors ?? [];
        const durations = (json.animations ?? []).map((a: GlbAnimation) =>
          Math.max(...(a.samplers ?? []).map((s) => accessors[s.input]?.max?.[0] ?? 0), 0),
        );
        return {
          names: (json.animations ?? []).map((a: GlbAnimation) => a.name ?? ''),
          meshes: (json.meshes ?? []).length,
          durations,
        };
      }
      offset += 8 + length + ((4 - (length % 4)) % 4);
    }
    throw new Error(`${url} has no JSON chunk`);
  }

  it('ships the authored peck as a mesh-free clip donor', () => {
    const glb = glbClips(ANIMS_URL);
    expect(glb.names).toEqual(['Kiwi_Peck', 'Kiwi_Death']);
    // A clip donor that drags the mesh along would double-draw the body.
    expect(glb.meshes).toBe(0);
  });

  it('composes the donor onto the form rig and plays the peck as the attack', () => {
    expect(VISUALS.form_kiwi?.animUrls).toContain(ANIMS_URL);
    expect(VISUALS.form_kiwi?.clips.attack).toEqual(['Kiwi_Peck']);
    // The generic slash is still IN the base GLB; the point is that nothing plays it.
    expect(VISUALS.form_kiwi?.clips.attack).not.toContain('Attack');
  });

  it('authors the peck to the feral swing cadence instead of speeding a preset up', () => {
    const glb = glbClips(ANIMS_URL);
    const duration = glb.durations[glb.names.indexOf('Kiwi_Peck')];
    // One peck per swing: it has to finish inside the fixed cadence, and it must
    // not be the 6.625s generic retarget wearing a new name.
    expect(duration).toBeGreaterThan(0.5);
    expect(duration).toBeLessThanOrEqual(CAT_FORM_SWING_SPEED);
    // With an authored clip the 6.6x speed-up is no longer load-bearing.
    expect(VISUALS.form_kiwi?.attackTimeScale).toBe(1);
  });
});

// The shipped Death was preset:biped:defeat_02, which on this rig never falls:
// its hand spread and head height sit at their idle values for the whole 8.5s,
// so the kiwi just stood there. The authored replacement topples it.
describe('Kiwi Form death fall', () => {
  it('plays the authored fall, not the preset that never falls', () => {
    expect(VISUALS.form_kiwi?.clips.death).toBe('Kiwi_Death');
    expect(VISUALS.form_kiwi?.clips.death).not.toBe('Death');
  });

  it('is authored at real time, so nothing has to speed it up', () => {
    // The old preset needed 3x to look like anything; the fall is timed already.
    expect(VISUALS.form_kiwi?.deathTimeScale).toBe(1);
  });
});
