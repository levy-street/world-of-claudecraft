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

  it('localizes an authenticated authored yell before its speaker snapshot arrives', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');

    const presented = chatDialoguePresentation(
      {
        channel: 'yell',
        entityId: 91,
        from: 'Runeseeker Maerin',
        text: MAERIN_LEDGER_LINE,
        authoredSpeaker: { kind: 'npc', templateId: 'runeseeker_maerin' },
      },
      undefined,
    );

    expect(presented.from).not.toBe('Runeseeker Maerin');
    expect(presented.text).not.toBe(MAERIN_LEDGER_LINE);
  });

  it('localizes an authenticated mob yell without a speaker snapshot', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');

    const presented = chatDialoguePresentation(
      {
        channel: 'yell',
        entityId: 92,
        from: 'Forest Wolf',
        text: MAERIN_LEDGER_LINE,
        authoredSpeaker: { kind: 'mob', templateId: 'forest_wolf' },
      },
      undefined,
    );

    expect(presented.from).not.toBe('Forest Wolf');
    expect(presented.text).not.toBe(MAERIN_LEDGER_LINE);
  });

  it('wires localized yell text to chat and bubbles while keeping the raw voice key', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/const dialogue = chatDialoguePresentation\(/);
    expect(source).toMatch(/this\.chatLogFrom\(\s*dialogue\.from,\s*dialogue\.text,/);
    expect(source).toMatch(/ev\.channel === 'yell' \? dialogue\.text : ev\.text/);
    expect(source).toMatch(/yellVoiceKey\(ev\.text\)/);
  });
});
