import { describe, expect, it } from 'vitest';
import {
  DISCORD_SPECIAL_ROLES,
  specialRoleByKey,
  specialRoleByName,
  specialRoleColor,
  topSpecialRole,
} from '../src/sim/discord_roles';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

describe('discord special roles - guild role name matching', () => {
  it('resolves the canonical staff role names (the original four)', () => {
    expect(specialRoleByName('Levy St')?.key).toBe('levyst');
    expect(specialRoleByName('Devs')?.key).toBe('devs');
    expect(specialRoleByName('Mods')?.key).toBe('mods');
    expect(specialRoleByName('Artists')?.key).toBe('artists');
  });

  it('resolves the Admin guild role to a dedicated admin key', () => {
    // The guild's staff role is named Admin; it must surface in game like
    // Levy St and Devs do (bug: previously there was no matching entry).
    expect(specialRoleByName('Admin')?.key).toBe('admin');
    expect(specialRoleByName('admin')?.key).toBe('admin');
    expect(specialRoleByName('Admins')?.key).toBe('admin');
    expect(specialRoleByName('Administrator')?.key).toBe('admin');
  });

  it('keeps the Admin nameplate color on the staff green the role has in Discord', () => {
    // The Admin role is the renamed Mods role, and renaming a Discord role
    // keeps its color, so admin inherits the staff green.
    expect(specialRoleColor('admin')).toBe('#57d98a');
  });

  it('resolves the singular Artist guild role name (bug: only Artists matched)', () => {
    expect(specialRoleByName('Artist')?.key).toBe('artists');
    expect(specialRoleByName('artist')?.key).toBe('artists');
  });

  it('resolves common aliases for the other staff roles', () => {
    expect(specialRoleByName('Levy Street')?.key).toBe('levyst');
    expect(specialRoleByName('Dev')?.key).toBe('devs');
    expect(specialRoleByName('Developers')?.key).toBe('devs');
    expect(specialRoleByName('Mod')?.key).toBe('mods');
    expect(specialRoleByName('Moderators')?.key).toBe('mods');
  });

  it('never resolves non-staff role names', () => {
    for (const name of ['everyone', 'WoC Champion', 'Member', 'Bots', '']) {
      expect(specialRoleByName(name)).toBeUndefined();
    }
  });
});

describe('discord special roles - priority', () => {
  it('ranks admin above devs and below levyst', () => {
    const levyst = specialRoleByKey('levyst');
    const admin = specialRoleByKey('admin');
    const devs = specialRoleByKey('devs');
    expect(admin).toBeDefined();
    expect(levyst!.priority).toBeGreaterThan(admin!.priority);
    expect(admin!.priority).toBeGreaterThan(devs!.priority);
  });

  it('picks the top role across mixed guild role names, aliases included', () => {
    expect(topSpecialRole(['Artist', 'Admin'])?.key).toBe('admin');
    expect(topSpecialRole(['Admin', 'Levy St'])?.key).toBe('levyst');
    expect(topSpecialRole(['Member', 'Artist'])?.key).toBe('artists');
    expect(topSpecialRole(['Member', 'WoC Champion'])).toBeUndefined();
  });

  it('keeps priorities unique so the top pick is deterministic', () => {
    const priorities = DISCORD_SPECIAL_ROLES.map((r) => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe('discord special roles - catalog integrity', () => {
  it('keeps the English tag catalog exactly in sync with the role keys', () => {
    const tags = hudChromeStrings.discord.roleTag as Record<string, string>;
    for (const role of DISCORD_SPECIAL_ROLES) {
      expect(tags[role.key], `missing hudChrome.discord.roleTag.${role.key}`).toBeTruthy();
    }
    const keys = new Set(DISCORD_SPECIAL_ROLES.map((r) => r.key));
    for (const tagKey of Object.keys(tags)) {
      expect(keys.has(tagKey), `stale roleTag entry '${tagKey}' has no catalog role`).toBe(true);
    }
  });

  it('gives every role a color and unique key and matcher names', () => {
    const keys = new Set<string>();
    const names = new Set<string>();
    for (const role of DISCORD_SPECIAL_ROLES) {
      expect(role.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(keys.has(role.key)).toBe(false);
      keys.add(role.key);
      for (const name of [role.name, ...(role.aliases ?? [])]) {
        const lower = name.toLowerCase();
        expect(names.has(lower), `duplicate matcher name '${name}'`).toBe(false);
        names.add(lower);
      }
    }
  });
});
