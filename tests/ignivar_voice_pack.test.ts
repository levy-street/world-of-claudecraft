import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { yellKey } from '../scripts/voices/extra_lines.mjs';
import { IGNIVAR_VOICE_EXTENSION_LINES } from '../scripts/voices/ignivar_voice_extension.mjs';
import {
  IGNIVAR_VOICE_PACK_LINES,
  validateIgnivarProductionReceipt,
} from '../scripts/voices/ignivar_voice_pack.mjs';
import { RAID_BOSS_ROOM_WELCOME_VOICE_LINES } from '../scripts/voices/raid_boss_room_welcome_voice_pack.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { IGNIVAR_DIALOGUE_LINES } from '../src/sim/encounters/ignivar_dialogue';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Ignivar production voice pack', () => {
  it('covers every unique yell currently emitted by the encounter', () => {
    expect(
      IGNIVAR_VOICE_PACK_LINES.map(
        (line: { key: string; text: string; processingPreset: string }) => ({
          key: line.key,
          text: line.text,
          processingPreset: line.processingPreset,
        }),
      ),
    ).toEqual([
      {
        key: 'yell__ignivar_ashcaller_awakens_let_the_world_burn',
        text: 'Ignivar Ashcaller awakens. Let the world burn!',
        processingPreset: 'robotic-automaton',
      },
      {
        key: 'yell__the_sky_itself_will_burn',
        text: 'The sky itself will burn!',
        processingPreset: 'robotic-automaton',
      },
      {
        key: 'yell__the_last_flame_consumes_all',
        text: 'The last flame consumes all!',
        processingPreset: 'robotic-automaton',
      },
      {
        key: 'yell__varkhul_the_seal_is_broken',
        text: 'Varkhul... the seal is broken.',
        processingPreset: 'robotic-automaton',
      },
    ]);
  });

  it('keeps every extension line on the approved robotic automaton treatment', () => {
    expect(
      IGNIVAR_VOICE_EXTENSION_LINES.map(
        (line: { processingPreset: string }) => line.processingPreset,
      ),
    ).toEqual(Array(7).fill('robotic-automaton'));
  });

  it('ships one versioned Ignivar clip for every live encounter line', () => {
    const roomWelcome = RAID_BOSS_ROOM_WELCOME_VOICE_LINES.filter(
      (line) => line.npcId === 'ignivar',
    );
    const authoredTexts = new Set([
      ...(IGNIVAR_VOICE_PACK_LINES as { text: string }[]).map((line) => line.text),
      ...(IGNIVAR_VOICE_EXTENSION_LINES as { text: string }[]).map((line) => line.text),
      ...roomWelcome.map((line) => line.text),
    ]);
    expect(authoredTexts).toEqual(new Set(IGNIVAR_DIALOGUE_LINES));

    for (const text of IGNIVAR_DIALOGUE_LINES) {
      const key = yellKey(text);
      expect(
        existsSync(join(repoRoot, 'public', 'audio', 'voice', 'ignivar', `${key}.mp3`)),
        text,
      ).toBe(true);
      expect(VOICE_LINES[key], text).toMatch(
        new RegExp(`^/audio/voice/ignivar/${key}\\.mp3\\?v=[a-f0-9]{12}$`),
      );
    }
  });

  it('keeps synthesis direction separate from the runtime yell key', () => {
    for (const line of IGNIVAR_VOICE_PACK_LINES as {
      text: string;
      synthesisText: string;
    }[]) {
      expect(line.synthesisText).toContain(line.text);
      expect(line.synthesisText).not.toBe(line.text);
    }
  });

  it('accepts only exact ordered receipts with valid clip bounds', () => {
    const receipt = {
      boss: 'ignivar',
      lines: IGNIVAR_VOICE_PACK_LINES.map((line, index) => ({
        key: line.key,
        text: line.text,
        start: index,
        end: index + 0.75,
      })),
    };
    expect(validateIgnivarProductionReceipt(IGNIVAR_VOICE_PACK_LINES, receipt, 'Receipt')).toEqual(
      IGNIVAR_VOICE_PACK_LINES.map((line, index) => ({
        ...line,
        start: index,
        end: index + 0.75,
      })),
    );

    expect(() =>
      validateIgnivarProductionReceipt(
        IGNIVAR_VOICE_PACK_LINES,
        { ...receipt, boss: 'varkhul' },
        'Receipt',
      ),
    ).toThrow('Receipt is not an Ignivar line receipt');
    expect(() =>
      validateIgnivarProductionReceipt(
        IGNIVAR_VOICE_PACK_LINES,
        { ...receipt, lines: receipt.lines.slice(1) },
        'Receipt',
      ),
    ).toThrow('Receipt must contain exactly 4 lines');
    expect(() =>
      validateIgnivarProductionReceipt(
        IGNIVAR_VOICE_PACK_LINES,
        {
          ...receipt,
          lines: receipt.lines.map((line, index) =>
            index === 0 ? { ...line, text: 'Wrong line' } : line,
          ),
        },
        'Receipt',
      ),
    ).toThrow('Receipt line 1 does not match the authored voice pack');
    expect(() =>
      validateIgnivarProductionReceipt(
        IGNIVAR_VOICE_PACK_LINES,
        {
          ...receipt,
          lines: receipt.lines.map((line, index) =>
            index === 0 ? { ...line, end: line.start } : line,
          ),
        },
        'Receipt',
      ),
    ).toThrow('Receipt line 1 has invalid clip bounds');
    expect(() =>
      validateIgnivarProductionReceipt(
        [{ ...IGNIVAR_VOICE_PACK_LINES[0], processingPreset: 'unapproved' }],
        { ...receipt, lines: receipt.lines.slice(0, 1) },
        'Receipt',
      ),
    ).toThrow('does not use robotic-automaton');
  });
});
