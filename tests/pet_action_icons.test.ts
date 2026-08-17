import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ABILITIES, MOBS } from '../src/sim/data';
import { abilityImageUrl, hasExplicitAbilityIcon } from '../src/ui/icons';
import {
  PET_ACTION_ICONS,
  PET_ACTION_IMAGE_IDS,
  petFeedButtonState,
  petSpecialButtonState,
} from '../src/ui/pet_action_icons';

// Regression guard for "Repeated icons on hunter class": the pet action bar used to pass
// class ability ids to the icon resolver, so pet buttons borrowed other classes' spell
// art (a hunter's aggressive stance == their own Rapid Fire; "Heal Pet" == the druid
// magic heal). Each pet action must have its OWN dedicated icon recipe instead.
describe('pet action bar icons', () => {
  const iconIds = Object.values(PET_ACTION_ICONS);
  const petArtDir = path.join(process.cwd(), 'public/ui/skills/pet');

  it('defines an icon for every pet action', () => {
    expect(iconIds.length).toBeGreaterThan(0);
  });

  it('never reuses a class ability id (the repeated-icon bug)', () => {
    const abilityIds = new Set(Object.keys(ABILITIES));
    const borrowed = iconIds.filter((id) => abilityIds.has(id));
    expect(borrowed, 'pet actions must use dedicated icons, not class ability art').toEqual([]);
  });

  it('gives every pet action its own explicit recipe (no procedural fallback)', () => {
    const missing = iconIds.filter((id) => !hasExplicitAbilityIcon(id));
    expect(missing, 'add these ids to ABILITY_RECIPES in src/ui/icons.ts').toEqual([]);
  });

  it('uses a distinct icon id per pet action', () => {
    expect(new Set(iconIds).size).toBe(iconIds.length);
  });

  it('ships one mapped, unique, opaque painted WebP for every synthetic command', async () => {
    const mapping = JSON.parse(readFileSync(path.join(petArtDir, 'mapping.json'), 'utf8')) as {
      iconSize: number;
      runtimeDir: string;
      acceptedArtManifest: string;
      abilities: Array<{
        abilityId: string;
        output: string;
        source: string;
        owner: string;
        license: string;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
      }>;
    };
    const committedIds = readdirSync(petArtDir)
      .filter((name) => name.endsWith('.webp'))
      .map((name) => path.basename(name, '.webp'))
      .sort();
    const mappedIds = mapping.abilities.map(({ abilityId }) => abilityId).sort();
    const expectedIds = [...PET_ACTION_IMAGE_IDS].sort();

    expect(iconIds.slice().sort()).toEqual(expectedIds);
    expect(committedIds).toEqual(expectedIds);
    expect(mappedIds).toEqual(expectedIds);
    expect(mapping).toMatchObject({
      iconSize: 128,
      runtimeDir: 'public/ui/skills/pet',
      acceptedArtManifest:
        'docs/achievements/release-v039-icon-art-first-pass-2026-08-16/accepted-art.json',
    });

    const hashes = new Set<string>();
    for (const entry of mapping.abilities) {
      expect(entry.output, entry.abilityId).toBe(`${entry.abilityId}.webp`);
      expect(entry.source, entry.abilityId).toBe('OpenAI built-in image generation');
      expect(entry.owner, entry.abilityId).toBe('World of ClaudeCraft');
      expect(entry.license, entry.abilityId).toContain('project asset');
      expect(entry.sourceSha256, entry.abilityId).toMatch(/^[0-9a-f]{64}$/);

      const url = abilityImageUrl(entry.abilityId);
      expect(url, entry.abilityId).toBe(`/ui/skills/pet/${entry.abilityId}.webp`);
      const file = path.join(process.cwd(), 'public', (url as string).slice(1));
      const bytes = readFileSync(file);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();

      expect(bytes.length, entry.abilityId).toBe(entry.acceptedBytes);
      expect(bytes.length, entry.abilityId).toBeLessThanOrEqual(15 * 1024);
      expect(hash, entry.abilityId).toBe(entry.acceptedSha256);
      expect(metadata, entry.abilityId).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      hashes.add(hash);
    }
    expect(hashes.size).toBe(expectedIds.length);
    expect(readFileSync(path.join(process.cwd(), 'CREDITS.md'), 'utf8')).toContain(
      'Shared pet action-bar command icons',
    );
  });

  it('gives each Warlock pet signature button dedicated painted art', () => {
    for (const id of ['emberkin_felbolt', 'gloomshade_abyssal_chain']) {
      expect(hasExplicitAbilityIcon(id), id).toBe(true);
      const url = abilityImageUrl(id);
      expect(url, id).toBe(`/ui/skills/warlock/${id}.webp`);
      expect(existsSync(path.join(process.cwd(), 'public', (url as string).slice(1))), id).toBe(
        true,
      );
    }
  });
});

describe('petSpecialButtonState', () => {
  it('projects Gloomshade and Emberkin skills with visible cooldown and autocast state', () => {
    expect(petSpecialButtonState(MOBS.gloomshade, 14.2, true)).toEqual({
      iconId: 'gloomshade_abyssal_chain',
      labelKey: 'hud.pet.abyssalChain',
      titleKey: 'hud.pet.abyssalChainTitle',
      descKey: 'hud.pet.abyssalChainDesc',
      cooldown: 15,
      autocast: true,
    });
    expect(petSpecialButtonState(MOBS.emberkin, 0, false)).toEqual({
      iconId: 'emberkin_felbolt',
      labelKey: 'hud.pet.felbolt',
      titleKey: 'hud.pet.felboltTitle',
      descKey: 'hud.pet.felboltDesc',
      cooldown: 0,
      autocast: false,
    });
  });

  it('does not invent a signature button for a pet without authored skill data', () => {
    expect(petSpecialButtonState(MOBS.forest_wolf, 0, false)).toBeNull();
  });
});

// The Feed Pet button used to look identically clickable whether or not it
// could actually do anything, so a hunter with a full-health pet or no food
// saw an inert button with no explanation. petFeedButtonState is the pure
// decision the button's disabled state and tooltip now render from.
describe('petFeedButtonState', () => {
  it('disables with the full-HP reason when the pet is already topped up, even with food on hand', () => {
    expect(petFeedButtonState(100, 100, true)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledFullHp',
    });
  });

  it('disables with the no-food reason when the pet is hurt but no food is eligible', () => {
    expect(petFeedButtonState(40, 100, false)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledNoFood',
    });
  });

  it('is enabled with no reason when the pet is hurt and food is available', () => {
    expect(petFeedButtonState(40, 100, true)).toEqual({ disabled: false, reasonKey: null });
  });

  it('does not read a zero maxHp as full health (guards the petMaxHp > 0 clause)', () => {
    // Before the pet's stats resolve, maxHp can momentarily be 0; petHp >= maxHp
    // would then falsely report "full health". The guard skips the full-HP
    // branch so it falls through to the food check instead.
    expect(petFeedButtonState(0, 0, false)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledNoFood',
    });
    expect(petFeedButtonState(0, 0, true)).toEqual({ disabled: false, reasonKey: null });
  });
});
