// Thornpeak's Deeprock Burrows wear the same authored bodies as Eastbrook's kobold
// camp: the Tunnelers and the Sappers the Foreman summons share the Diggers' rat
// body, and the Foreman, the camp's rare elite, shares Grix the Tunnelking's.
// Pinned per TEMPLATE because the swap is deliberately a MOB_KEYS override and
// not a family repoint: the `burrower` family also carries sprites, gnomes and
// wretches that must stay on the goblin fallback.
import { describe, expect, it } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';

const keyFor = (templateId: string) =>
  visualKeyFor({ kind: 'mob', templateId } as unknown as Parameters<typeof visualKeyFor>[0]);

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

  it('mirrors the Eastbrook camp exactly: same adds body, same boss body', () => {
    expect(keyFor('tunnel_rat')).toBe(keyFor('deeprock_kobold'));
    expect(keyFor('grix_the_tunnelking')).toBe(keyFor('ironvein_foreman'));
  });

  it('leaves the rest of the burrower family on the goblin fallback', () => {
    expect(MOBS.hedge_gnome.family).toBe('burrower');
    expect(keyFor('hedge_gnome')).toBe('mob_kobold');
  });
});
