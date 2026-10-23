// Thornpeak's Deeprock Burrows wear the same authored bodies as Eastbrook's kobold
// camp: the Tunnelers and the Sappers the Foreman summons share the Diggers' rat
// body, and the Foreman, the camp's rare elite, shares Grix the Tunnelking's.
// Pinned per TEMPLATE because the swap is deliberately a MOB_KEYS override and
// not a family repoint: the `burrower` family also carries sprites, a gnome,
// bandits and wretches, which are not kobolds and must stay on the goblin fallback.
import { describe, expect, it } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';

const keyFor = (templateId: string) =>
  visualKeyFor({ kind: 'mob', templateId } as unknown as Parameters<typeof visualKeyFor>[0]);

// The burrowers that are not kobolds. They share the family, never the rat body.
const NOT_KOBOLDS = [
  'fen_sprite',
  'harvest_sprite',
  'willow_sprite',
  'hedge_gnome',
  'downs_bandit',
  'wreck_thief',
  'breach_wretch',
] as const;

describe('Thornpeak Deeprock Burrows: the burrower templates and their bodies', () => {
  it('puts the Tunnelers and the Sappers on the Diggers authored body', () => {
    expect(MOBS.deeprock_kobold.family).toBe('burrower');
    expect(MOBS.ironvein_sapper.family).toBe('burrower');
    expect(keyFor('deeprock_kobold')).toBe('mob_kobold_digger');
    expect(keyFor('ironvein_sapper')).toBe('mob_kobold_digger');
  });

  it('puts the Ironvein Foreman, who summons those Sappers, on the Tunnelking body', () => {
    expect(MOBS.ironvein_foreman.rare).toBe(true);
    expect(MOBS.ironvein_foreman.elite).toBe(true);
    expect(MOBS.ironvein_foreman.summonAdds?.mobId).toBe('ironvein_sapper');
    expect(keyFor('ironvein_foreman')).toBe('mob_grix');
  });

  it('mirrors the Eastbrook camp exactly: same camp body, same boss body', () => {
    expect(keyFor('tunnel_rat')).toBe('mob_kobold_digger');
    expect(keyFor('grix_the_tunnelking')).toBe('mob_grix');
    expect(keyFor('deeprock_kobold')).toBe(keyFor('tunnel_rat'));
    expect(keyFor('ironvein_foreman')).toBe(keyFor('grix_the_tunnelking'));
  });

  it.each(NOT_KOBOLDS)('leaves %s, which is not a kobold, on the goblin fallback', (id) => {
    expect(MOBS[id].family).toBe('burrower');
    expect(keyFor(id)).toBe('mob_kobold');
  });

  it('gives the kobold bodies to the two kobold camps and to nobody else', () => {
    const onKoboldBodies = Object.keys(MOBS)
      .filter((id) => ['mob_kobold_digger', 'mob_grix'].includes(keyFor(id)))
      .sort();
    expect(onKoboldBodies).toEqual([
      'deeprock_kobold',
      'grix_the_tunnelking',
      'ironvein_foreman',
      'ironvein_sapper',
      'tunnel_rat',
    ]);
  });
});
