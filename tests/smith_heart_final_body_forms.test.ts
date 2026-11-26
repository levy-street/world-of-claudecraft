// The Masterless Strength's five forms through its body painter (final_body_fx.ts): one mesh,
// five paintings, and the painter tells the rig which painting to wear through the mesh
// toggle gestures. This drives the real FinalBodyFx over a recording gesture sink: the base
// form in the ring and before the pull, the transformation between any two forms (the old
// painting kept until the burst), the corpse keeping the form it died in, and every form
// change sending one painting on and the other four off.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FINAL_BODY_FORMS,
  FINAL_BODY_GESTURES,
  FINAL_SHIFT,
  type FinalBodyForm,
} from '../src/render/smith_heart_fx/final_body_core';
import { FinalBodyFx, type FinalBodyHost } from '../src/render/smith_heart_fx/final_body_fx';
import { EngineParticles } from '../src/render/trash_engine_fx/engine_particles';
import type { HeartQuarterZone } from '../src/sim/content/smith_heart_quarters';
import type { Entity } from '../src/sim/types';

const G = FINAL_BODY_GESTURES;
const DT = 0.05;

interface Sent {
  at: number;
  gesture: string;
}

function rig() {
  const flashes: number[] = [];
  const host: FinalBodyHost = {
    particles: new EngineParticles(
      new THREE.Group(),
      { value: 0 },
      1,
      () => 0,
      () => 0.5,
      () => false,
      null,
    ),
    density: 1,
    flash: (_x, _y, _z, _size, _life, color) => {
      flashes.push(color);
    },
    shakeNear: () => {},
    rand: () => 0.5,
    groundY: () => 0,
  };
  const boss = {
    id: 7,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    scale: 1,
    auras: [],
  } as unknown as Entity;
  const sent: Sent[] = [];
  let clock = 0;
  const fx = new FinalBodyFx(new THREE.Group(), host, (_id, gesture) =>
    sent.push({ at: clock, gesture }),
  );
  /** Run the fight forward `seconds` in `zone` (a standing, lit, whole body). */
  const run = (zone: HeartQuarterZone, seconds: number, dead = false) => {
    const until = clock + seconds;
    for (; clock < until - 1e-9; clock += DT)
      fx.update({
        boss,
        zone,
        whole: true,
        forming: false,
        stance: 'stand',
        dark: false,
        dead,
        clock,
        dt: DT,
      });
  };
  return { fx, sent, flashes, run, now: () => clock };
}

const isOn = (g: string) => (Object.values(G.on) as string[]).includes(g);
const isOff = (g: string) => (Object.values(G.off) as string[]).includes(g);

/** The form the rig was last told to wear. */
function worn(sent: readonly Sent[]): FinalBodyForm | null {
  for (let i = sent.length - 1; i >= 0; i--)
    for (const form of FINAL_BODY_FORMS) if (sent[i].gesture === G.on[form]) return form;
  return null;
}

const shifts = (sent: readonly Sent[]) => sent.filter((s) => s.gesture === G.shift);

describe("the Masterless Strength's forms through its body painter", () => {
  it('wears the base form in the ring and before the pull, with no transformation', () => {
    const r = rig();
    r.run('ring', 3);
    expect(worn(r.sent)).toBe('four');
    expect(r.sent.some((s) => s.gesture === G.on.four)).toBe(true);
    for (const form of FINAL_BODY_FORMS)
      if (form !== 'four') expect(r.sent.some((s) => s.gesture === G.on[form])).toBe(false);
    // A first sight just shows the right painting: no Shift, no burst.
    expect(shifts(r.sent)).toHaveLength(0);
    expect(r.flashes).toHaveLength(0);
  });

  it('sends one painting on and the other four off on every form change', () => {
    const r = rig();
    r.run('ring', 1);
    r.run('heat', 3);
    r.run('quench', 3);
    const ons = r.sent.filter((s) => isOn(s.gesture));
    expect(ons.length).toBeGreaterThan(4);
    for (const on of ons) {
      const form = FINAL_BODY_FORMS.find((f) => G.on[f] === on.gesture);
      expect(form).toBeDefined();
      // In the same update: the four other forms off, never its own.
      const offs = r.sent.filter((s) => s.at === on.at && isOff(s.gesture)).map((s) => s.gesture);
      const others = FINAL_BODY_FORMS.filter((f) => f !== form).map((f) => G.off[f]);
      expect([...offs].sort()).toEqual([...others].sort());
      expect(r.sent.filter((s) => s.at === on.at && isOn(s.gesture))).toHaveLength(1);
    }
    // Every off rides an on: a form is never switched off with nothing put on.
    for (const off of r.sent.filter((s) => isOff(s.gesture)))
      expect(ons.some((on) => on.at === off.at)).toBe(true);
  });

  it('transforms from the base form into a quarter: the old painting until the burst', () => {
    const r = rig();
    r.run('ring', 2);
    const pulled = r.now();
    r.run('hammer', 4);
    // One Shift, on the frame the quarter was named.
    expect(shifts(r.sent)).toHaveLength(1);
    expect(shifts(r.sent)[0].at).toBeCloseTo(pulled, 6);
    // The base form stays on through the charge; the Hammer's goes on at the burst.
    const first = r.sent.find((s) => s.gesture === G.on.hammer);
    expect(first).toBeDefined();
    expect(first?.at).toBeGreaterThanOrEqual(pulled + FINAL_SHIFT.burst - 1e-6);
    expect(first?.at).toBeLessThan(pulled + FINAL_SHIFT.burst + 2 * DT);
    const charge = r.sent.filter((s) => s.at >= pulled && s.at < (first?.at ?? 0));
    expect(charge.some((s) => s.gesture === G.on.four)).toBe(true);
    for (const s of charge) if (isOn(s.gesture)) expect(s.gesture).toBe(G.on.four);
    expect(worn(r.sent)).toBe('hammer');
    // The burst flashed (the base form and the Hammer share the Hammer's light).
    expect(r.flashes.length).toBeGreaterThan(0);
  });

  it('transforms back to the base form in the ring, and between two elements', () => {
    const r = rig();
    r.run('ring', 1);
    r.run('hammer', 4);
    expect(shifts(r.sent)).toHaveLength(1);
    // Back into the ring: the Hammer's light again, and still a transformation.
    r.run('ring', 4);
    expect(shifts(r.sent)).toHaveLength(2);
    expect(worn(r.sent)).toBe('four');
    r.run('heat', 4);
    expect(shifts(r.sent)).toHaveLength(3);
    expect(worn(r.sent)).toBe('heat');
    r.run('quench', 4);
    expect(shifts(r.sent)).toHaveLength(4);
    expect(worn(r.sent)).toBe('quench');
    r.run('breath', 4);
    expect(shifts(r.sent)).toHaveLength(5);
    expect(worn(r.sent)).toBe('breath');
    // Holding a quarter never transforms again (the re-sends only name the form worn).
    r.run('breath', 6);
    expect(shifts(r.sent)).toHaveLength(5);
    expect(worn(r.sent)).toBe('breath');
  });

  it('a corpse keeps the form it died in, though its state aura is gone', () => {
    const r = rig();
    r.run('ring', 1);
    r.run('heat', 4);
    expect(worn(r.sent)).toBe('heat');
    const died = r.sent.length;
    const before = shifts(r.sent).length;
    // Dead: the fight's state aura goes with it, so the zone reads the ring.
    r.run('ring', 5, true);
    expect(shifts(r.sent)).toHaveLength(before);
    const after = r.sent.slice(died);
    expect(after.some((s) => s.gesture === G.on.heat)).toBe(true);
    for (const s of after) if (isOn(s.gesture)) expect(s.gesture).toBe(G.on.heat);
  });

  it('a death in mid-transformation holds the painting it wore, with no burst', () => {
    const r = rig();
    r.run('ring', 1);
    r.run('heat', 4);
    const flashed = r.flashes.length;
    // The Quench is named, and it dies in the charge, before the burst.
    r.run('quench', FINAL_SHIFT.burst / 2);
    const died = r.sent.length;
    r.run('ring', 5, true);
    const after = r.sent.slice(died);
    for (const s of after) if (isOn(s.gesture)) expect(s.gesture).toBe(G.on.heat);
    expect(after.some((s) => s.gesture === G.on.heat)).toBe(true);
    expect(after.some((s) => s.gesture === G.shift)).toBe(false);
    expect(r.flashes).toHaveLength(flashed);
  });

  it('a corpse first seen dead shows the base form, with no transformation', () => {
    const r = rig();
    r.run('ring', 3, true);
    expect(worn(r.sent)).toBe('four');
    expect(shifts(r.sent)).toHaveLength(0);
  });
});
