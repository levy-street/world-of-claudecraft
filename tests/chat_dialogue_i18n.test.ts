import { afterEach, describe, expect, it } from 'vitest';
import { NPCS } from '../src/sim/data';
import { createNpc, createPlayer } from '../src/sim/entity';
import { chatDialoguePresentation } from '../src/ui/chat_dialogue_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

const MAERIN_LEDGER_LINE =
  'Beast provisions, wages, kennel feed... and the signature page torn out. Someone left in a hurry. North.';

afterEach(() => setLanguage('en'));

describe('authored chat dialogue localization', () => {
  it('localizes a Maerin yell for chat, bubbles, and assistive output presentation', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const maerin = createNpc(91, NPCS.runeseeker_maerin, { x: 0, y: 0, z: 0 });

    const presented = chatDialoguePresentation(
      {
        channel: 'yell',
        entityId: maerin.id,
        from: maerin.name,
        text: MAERIN_LEDGER_LINE,
      },
      maerin,
    );

    expect(presented.from).not.toBe(maerin.name);
    expect(presented.text).not.toBe(MAERIN_LEDGER_LINE);
  });

  it('does not rewrite a player-authored yell even when it copies a Maerin line', async () => {
    await ensureLocaleLoaded('de_DE');
    const player = createPlayer(17, 'mage', { x: 0, y: 0, z: 0 }, 'MaerinFan');
    setLanguage('de_DE');

    expect(
      chatDialoguePresentation(
        {
          channel: 'yell',
          entityId: player.id,
          classId: 'mage',
          from: player.name,
          text: MAERIN_LEDGER_LINE,
        },
        player,
      ),
    ).toEqual({ from: player.name, text: MAERIN_LEDGER_LINE });
  });

  it('keeps raw yell text on the voice lookup path', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/yellVoiceKey\(ev\.text\)/);
  });
});
