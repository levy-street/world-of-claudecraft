// A boss authored rooted (moveSpeed 0) stays rooted on heroic and still fights.
// The heroic anti-kite floor used to lift every template to 8 yd a second, so on
// heroic the generic chase could walk a rooted boss off its spot (the Gorgebloom
// off its dais, the Mere Hydra's heads out of their pool, Choirmother Selthe and
// Ysolei off their altars), where normal never moved them. Driven through real
// Sim ticks on a real claimed heroic Wildheart Basin: the bloom is pulled, its
// target stands out of its reach, and it answers the way its design says (the
// Bloom Spit), from the dais.

import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { GORGEBLOOM_ID, BLOOM_TUNING as T } from '../src/sim/encounters/wildheart_basin';
import { boss, engage, fight, hitsOn, put, tick } from './helpers/wildheart_fight';

vi.setConfig({ testTimeout: 300_000 });

describe('the Gorgebloom on heroic: rooted on its dais, never kited', () => {
  it('does not walk at a target out of its reach, and spits at it instead', () => {
    expect(MOBS[GORGEBLOOM_ID].moveSpeed).toBe(0);
    const f = fight('heroic');
    const bloom = boss(f, GORGEBLOOM_ID);
    put(f, f.tank, 90, 40);
    const rim: [number, number][] = [
      [100, 30],
      [102, 58],
      [62, 36],
    ];
    f.others.forEach((p, i) => {
      put(f, p, rim[i][0], rim[i][1]);
    });
    engage(f, bloom);
    expect(bloom.moveSpeed).toBe(0);
    const dais = { x: bloom.pos.x, z: bloom.pos.z };
    // The tank steps well out of its reach and stays there; the others stand.
    const away = () => {
      put(f, f.tank, 64, 50);
      f.others.forEach((p, i) => {
        put(f, p, rim[i][0], rim[i][1]);
      });
    };
    const from = f.hits.length;
    let drift = 0;
    const seconds = T.spitDelay + T.spitEvery * 3 + 0.5;
    for (let t = 0; t < seconds; t += 0.05) {
      tick(f, away);
      drift = Math.max(drift, Math.hypot(bloom.pos.x - dais.x, bloom.pos.z - dais.z));
    }
    // Rooted: not a yard, however long its target stands off.
    expect(drift).toBe(0);
    expect(bloom.dead).toBe(false);
    expect(bloom.inCombat).toBe(true);
    // And it still fights from there: the Bloom Spit lands on the tank.
    expect(hitsOn(f, f.tank, 'Bloom Spit', from).length).toBeGreaterThanOrEqual(2);
  });
});
