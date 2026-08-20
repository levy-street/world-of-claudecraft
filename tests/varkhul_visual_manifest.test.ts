import { describe, expect, it } from 'vitest';
import { manifestUrlsForGraphics, VISUALS, visualKeyFor } from '../src/render/characters/manifest';

const AUTOMATA = [
  {
    templateId: 'ignivar_ember_sentinel',
    key: 'mob_ignivar_ember_sentinel',
    url: 'models/creatures/ignivar_ember_sentinel.glb',
  },
  {
    templateId: 'ignivar_crucible_warden',
    key: 'mob_ignivar_crucible_warden',
    url: 'models/creatures/ignivar_crucible_warden.glb',
  },
  {
    templateId: 'ignivar_cinder_artificer',
    key: 'mob_ignivar_cinder_artificer',
    url: 'models/creatures/ignivar_cinder_artificer.glb',
  },
] as const;

describe('expanded Ignivar raid visual manifest', () => {
  it('maps each automaton to a distinct generated rig', () => {
    for (const expected of AUTOMATA) {
      const key = visualKeyFor({ kind: 'mob', templateId: expected.templateId } as never);
      expect(key).toBe(expected.key);
      expect(VISUALS[key].url).toBe(expected.url);
      expect(VISUALS[key].clips).toMatchObject({
        idle: 'Idle',
        walk: 'Walking_A',
        run: 'Running_A',
        attack: ['1H_Melee_Attack_Chop'],
        cast: 'Spellcasting',
        death: 'Death_A',
      });
    }
    expect(new Set(AUTOMATA.map(({ key }) => VISUALS[key].url)).size).toBe(AUTOMATA.length);
  });

  it("mounts Varkhul's separate warhammer on the right hand socket", () => {
    const key = visualKeyFor({
      kind: 'mob',
      templateId: 'varkhul_forgefather_of_the_last_flame',
    } as never);
    const visual = VISUALS[key];
    expect(key).toBe('mob_varkhul');
    expect(visual.url).toBe('models/creatures/varkhul_forge_master.glb');
    expect(visual.attach).toEqual([
      {
        url: 'models/weapons/varkhul_warhammer.glb',
        bone: 'handslot.r',
        position: [0, 0, 0],
        rotationY: Math.PI,
      },
    ]);
    expect(visual.clips).toMatchObject({
      idle: 'Idle',
      walk: 'Walking_A',
      run: 'Running_A',
      attack: ['1H_Melee_Attack_Chop'],
      cast: 'Spellcasting',
      death: 'Death_A',
    });
  });

  it('keeps unfinished raid rigs and the hammer out of the fatal boot preload', () => {
    const expected = [
      ...AUTOMATA.map(({ url }) => url),
      'models/creatures/varkhul_forge_master.glb',
      'models/weapons/varkhul_warhammer.glb',
    ];
    for (const key of [...AUTOMATA.map(({ key }) => key), 'mob_varkhul']) {
      expect(VISUALS[key].lazyPreload).toBe(true);
    }
    for (const standardMaterials of [false, true]) {
      expect(manifestUrlsForGraphics(standardMaterials)).not.toEqual(
        expect.arrayContaining(expected),
      );
      for (const url of expected) {
        expect(manifestUrlsForGraphics(standardMaterials)).not.toContain(url);
      }
    }
  });

  it('reuses the established archivist body for Maelin Emberward', () => {
    const maelin = visualKeyFor({
      kind: 'npc',
      templateId: 'archivist_maelin_emberward',
    } as never);
    const tullo = visualKeyFor({ kind: 'npc', templateId: 'archivist_tullo' } as never);
    expect(maelin).toBe(tullo);
    expect(maelin).toBe('npc_villager_robed');
  });
});
