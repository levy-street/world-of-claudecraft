import { expect, it } from 'vitest';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { cannonResultText, cannonTacticsHint } from '../src/ui/hud/vehicle/cannon_tactics_view';
import { setLanguage } from '../src/ui/i18n';
import { questEventPresentation } from '../src/ui/quest_event_view';

it('presents result facts from the authoritative event and rejects malformed results', () => {
  setLanguage('en');
  const result = { medal: 'gold' as const, integrity: 95, shotsFired: 20, shotsHit: 16 };
  expect(cannonResultText(result)).toBe('Gold medal: integrity 95%, accuracy 80%.');
  expect(questEventPresentation({ type: 'cannonResult', pid: 1, ...result })).toMatchObject({
    bannerText: cannonResultText(result),
    logText: cannonResultText(result),
    sound: 'quest_complete',
  });
  expect(cannonResultText({ ...result, shotsHit: 21 })).toBeNull();
  expect(cannonResultText({ ...result, integrity: NaN })).toBeNull();
  expect(cannonResultText({ ...result, medal: null })).toContain('Defense failed');
});
it('prioritizes actionable sapper, charge, armor and barrel guidance', () => {
  setLanguage('en');
  const s = createCannonEncounter();
  expect(cannonTacticsHint(s)).toContain('powder barrels');
  s.enemies = [{ id: 1, kind: 'armored', hp: 220, x: 0, z: 0, slowUntilTick: 0 }];
  expect(cannonTacticsHint(s)).toContain('Cannonball');
  s.enemies[0].armorBroken = true;
  expect(cannonTacticsHint(s)).toContain('double damage');
  s.commanderCharging = true;
  expect(cannonTacticsHint(s)).toContain('charge');
  s.enemies[0].kind = 'sapper';
  expect(cannonTacticsHint(s)).toContain('Sapper');
});
