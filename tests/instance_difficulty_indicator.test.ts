import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID } from '../src/sim/ignivar_raid_ids';
import { dungeonTitleWithDifficulty } from '../src/ui/dungeon_map_painter';
import { dungeonDisplayName } from '../src/ui/entity_i18n';
import type { IWorld } from '../src/world_api';

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function mockWorld(dungeonId: string, difficulty: 'normal' | 'heroic'): IWorld {
  const origin = instanceOrigin(DUNGEONS[dungeonId].index, 0);
  const player = {
    id: 1,
    kind: 'player',
    templateId: 'warrior',
    name: 'Hero',
    pos: { x: origin.x, y: 0, z: origin.z },
    facing: 0,
  };
  return {
    player,
    entities: new Map([[player.id, player]]),
    dungeonDifficulty: () => difficulty,
  } as unknown as IWorld;
}

describe('instance difficulty indicator', () => {
  it('formats zone label with Normal and Heroic difficulty in dungeon titles', () => {
    const normalWorld = mockWorld('hollow_crypt', 'normal');
    expect(dungeonTitleWithDifficulty('hollow_crypt', normalWorld)).toBe(
      `${dungeonDisplayName('hollow_crypt')} (Normal)`,
    );

    const heroicWorld = mockWorld('hollow_crypt', 'heroic');
    expect(dungeonTitleWithDifficulty('hollow_crypt', heroicWorld)).toBe(
      `${dungeonDisplayName('hollow_crypt')} (Heroic)`,
    );
  });

  it('formats raid instance titles with difficulty on Ignivar assembly', () => {
    const normalWorld = mockWorld(IGNIVAR_MOLTEN_ASSEMBLY_ID, 'normal');
    expect(dungeonTitleWithDifficulty(IGNIVAR_MOLTEN_ASSEMBLY_ID, normalWorld)).toBe(
      `${dungeonDisplayName(IGNIVAR_MOLTEN_ASSEMBLY_ID)} (Normal)`,
    );

    const heroicWorld = mockWorld(IGNIVAR_MOLTEN_ASSEMBLY_ID, 'heroic');
    expect(dungeonTitleWithDifficulty(IGNIVAR_MOLTEN_ASSEMBLY_ID, heroicWorld)).toBe(
      `${dungeonDisplayName(IGNIVAR_MOLTEN_ASSEMBLY_ID)} (Heroic)`,
    );
  });

  it('ships instance-difficulty button in both entry HTML files with a11y labels', () => {
    for (const file of ['index.html', 'play.html']) {
      const html = read(file);
      expect(html, file).toMatch(
        /<button id="instance-difficulty" class="ui-disc" type="button" hidden data-i18n-title="[^"]*" data-i18n-aria="[^"]*" title="[^"]*" aria-label="[^"]*"><\/button>/,
      );
    }
  });

  it('defines desktop styles for instance-difficulty badge and states in hud.css', () => {
    const css = read('src/styles/hud.css');
    expect(css).toMatch(/#instance-difficulty\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/#instance-difficulty\[hidden\]\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/#instance-difficulty\.heroic\s*\{[^}]*color:\s*var\(--gold\)/);
    expect(css).toMatch(/#instance-difficulty\.normal\s*\{/);
  });

  it('defines mobile touch styles for instance-difficulty in hud.mobile.css', () => {
    const mobileCss = read('src/styles/hud.mobile.css');
    expect(mobileCss).toMatch(
      /body\.mobile-touch #instance-difficulty\s*\{[^}]*width:\s*var\(--rim-satellite-size/,
    );
  });
});
