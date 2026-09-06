import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { locomotionTimeScale } from '../src/render/characters/anim_state';
import { VISUALS } from '../src/render/characters/manifest';
import { ABILITIES } from '../src/sim/content/classes';
import { RUN_SPEED } from '../src/sim/types';

interface GlbAnimation {
  name?: string;
  samplers?: { input: number }[];
}

const publicPath = (url: string): string =>
  fileURLToPath(new URL(`../public/${url.replace(/^\//, '')}`, import.meta.url));

/** Clip names, mesh count and durations out of a GLB's JSON chunk,
 *  dependency-free (the pattern tests/character_clipmaps.test.ts uses, so the
 *  gate cannot be fooled by whatever the runtime loader stack does). */
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

const MODEL_URL = 'models/creatures/longstride.glb';
const ANIMS_URL = 'models/creatures/longstride_anims.glb';

describe('Strider Form body', () => {
  it('replaces the chicken-cow with the Longstride', () => {
    expect(VISUALS.form_travel?.url).toBe(MODEL_URL);
    expect(VISUALS.form_travel?.url).not.toBe('models/creatures/chicken_cow.glb');
    // No tint: the body ships its own rust coat, bone bill and orange feet.
    expect(VISUALS.form_travel?.tint).toBeUndefined();
  });

  it('drops out of the bear mass class, which is the read the height change buys', () => {
    // At the chicken-cow's 2.3 the travel form sat within a rounding error of
    // the bear's 2.35, so shifting to RUN made a druid a bigger target. The
    // point of 2.1 is the gap, so pin the relation and not just the literal.
    expect(VISUALS.form_travel?.height).toBe(2.1);
    const bear = VISUALS.form_bear?.height ?? 0;
    expect(bear).toBeGreaterThan(0);
    expect(VISUALS.form_travel?.height ?? 0).toBeLessThan(bear);
    // ...and still under the 2.6 caster, so it never becomes the tallest thing
    // a druid can be.
    expect(VISUALS.form_travel?.height ?? 0).toBeLessThan(2.6);
  });

  it('yaws the Tripo biped from +X onto the game facing-0 convention', () => {
    // Off by a quarter turn and the form runs sideways; 0 or undefined is the bug.
    expect(VISUALS.form_travel?.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('ships both GLBs and registers them in the media manifest', () => {
    expect(existsSync(publicPath(MODEL_URL))).toBe(true);
    expect(existsSync(publicPath(ANIMS_URL))).toBe(true);
    expect(MEDIA_ASSETS[MODEL_URL]).toMatch(
      /^\/media\/models\/creatures\/longstride[.][0-9a-f]+[.]glb$/,
    );
    expect(MEDIA_ASSETS[ANIMS_URL]).toMatch(
      /^\/media\/models\/creatures\/longstride_anims[.][0-9a-f]+[.]glb$/,
    );
  });

  it('preloads at boot like the other shapeshift bodies', () => {
    // A lazyPreload form pops in a frame late on the first shift of a session.
    expect(VISUALS.form_travel?.lazyPreload).toBeUndefined();
  });
});

// The rig arrived from the asset pipeline with generic `preset:biped:*`
// retargets. They are authored for a person, and on this rig NeckTwist01 carries
// the moa's whole neck AND bill, so a preset that rotates it 77 degrees puts the
// head behind the flank. Every one of the eight does it, which is why the form
// plays authored clips instead (scripts/build_longstride_anims.mjs).
describe('Strider Form authored clips', () => {
  it('ships all six as a mesh-free clip donor', () => {
    const glb = glbClips(ANIMS_URL);
    expect(glb.names).toEqual([
      'Strider_Idle',
      'Strider_Walk',
      'Strider_Run',
      'Strider_Jump',
      'Strider_Peck',
      'Strider_Topple',
    ]);
    // A clip donor that drags the mesh along would double-draw the body.
    expect(glb.meshes).toBe(0);
  });

  it('composes the donor onto the form rig and plays no preset clip', () => {
    const def = VISUALS.form_travel;
    expect(def?.animUrls).toContain(ANIMS_URL);
    // Every slot names an authored clip. The presets are still IN the base GLB
    // (they are the donor the legs come from); the point is nothing plays them.
    expect(def?.clips.idle).toBe('Strider_Idle');
    expect(def?.clips.walk).toBe('Strider_Walk');
    expect(def?.clips.run).toBe('Strider_Run');
    expect(def?.clips.jump).toBe('Strider_Jump');
    expect(def?.clips.attack).toEqual(['Strider_Peck']);
    expect(def?.clips.death).toBe('Strider_Topple');
    for (const preset of ['Idle', 'Walk', 'Run', 'Jump', 'Attack', 'Death']) {
      expect(Object.values(def?.clips ?? {}).flat()).not.toContain(preset);
    }
  });

  it('authors the peck and the topple at real time, not as sped-up presets', () => {
    const glb = glbClips(ANIMS_URL);
    const peck = glb.durations[glb.names.indexOf('Strider_Peck')];
    const topple = glb.durations[glb.names.indexOf('Strider_Topple')];
    // The generic slash was 6.625s and the defeat 8.5s; neither is these.
    expect(peck).toBeGreaterThan(0.5);
    expect(peck).toBeLessThan(1.5);
    expect(topple).toBeCloseTo(2, 1);
    expect(VISUALS.form_travel?.attackTimeScale).toBe(1);
    expect(VISUALS.form_travel?.deathTimeScale).toBe(1);
  });
});

// walkRef/runRef are the speeds the clips are AUTHORED for: inside the
// locomotionTimeScale clamp the played foot rate equals body speed exactly, so a
// foot only skates when the clamp bites. The chicken-cow carried no refs at all,
// which is why it skated.
describe('Strider Form gait cadence', () => {
  const travelMult = (() => {
    const effect = ABILITIES.travel_form?.effects?.[0];
    return effect && 'value' in effect ? (effect.value as number) : 0;
  })();
  const at = (speed: number) =>
    locomotionTimeScale(
      'run',
      { speed, backwards: false, reverseBackpedal: false },
      VISUALS.form_travel?.walkRef,
      VISUALS.form_travel?.runRef,
    );

  it('derives its travel speed from the buff the ability actually grants', () => {
    // If the buff is ever retuned, the cadence below has to move with it; this
    // is the assertion that fails first and says why.
    expect(travelMult).toBeCloseTo(1.4, 6);
  });

  it('plays the run at timeScale 1.0 at the speed the form actually moves', () => {
    const travelSpeed = RUN_SPEED * travelMult; // 9.8 yd/s
    expect(at(travelSpeed)).toBeCloseTo(1, 2);
  });

  it('leaves clamp headroom on both sides for snares and speed buffs', () => {
    const travelSpeed = RUN_SPEED * travelMult;
    // Not sitting on either bound at the normal case is the whole point: a ref
    // that pegs the clamp is a ref that skates.
    expect(at(travelSpeed)).toBeGreaterThan(0.6);
    expect(at(travelSpeed)).toBeLessThan(1.6);
    // A hard snare still moves the legs rather than freezing at the floor.
    expect(at(travelSpeed * 0.75)).toBeGreaterThan(0.6);
  });

  it('is measured for this form, not copied from another rig', () => {
    // The bear's 5.4 was measured against RUN_SPEED 7 on a quadruped, and the
    // engine default is RUN_SPEED itself. Either one on a body that travels at
    // 9.8 pegs the 1.6 clamp and skates.
    expect(VISUALS.form_travel?.runRef).not.toBe(RUN_SPEED);
    expect(VISUALS.form_travel?.runRef).not.toBe(VISUALS.form_bear?.runRef);
    expect(at(RUN_SPEED * travelMult)).not.toBe(1.6);
    expect(VISUALS.form_travel?.walkRef).toBeGreaterThan(0);
    expect(VISUALS.form_travel?.runRef).toBeGreaterThan(0);
  });
});

describe('Strider Form ability copy', () => {
  it('renames the form without touching what it does', () => {
    const ability = ABILITIES.travel_form;
    expect(ability?.name).toBe('Strider Form');
    expect(ability?.name).not.toBe('Fleet Form');
    // The concept is explicit that this is a name and description change only:
    // id, cost, cooldown, learn level and the selfBuff are all unchanged.
    expect(ability?.id).toBe('travel_form');
    expect(ability?.cost).toBe(30);
    expect(ability?.cooldown).toBe(0);
    expect(ability?.learnLevel).toBe(11);
    expect(ability?.effects).toEqual([
      { type: 'selfBuff', kind: 'form_travel', value: 1.4, duration: 3600 },
    ]);
  });

  it('leaves no stale form name in the description', () => {
    expect(ability_description()).not.toMatch(/fleet/i);
    expect(ability_description()).toMatch(/40%/);
  });
});

function ability_description(): string {
  return ABILITIES.travel_form?.description ?? '';
}
