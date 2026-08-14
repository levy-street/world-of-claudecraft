// Membership pins for the extracted heavy-self policy (server/heavy_self.ts,
// moved whole from server/game.ts at the v0.38.0 fourteenth absorb). The
// farming members' BEHAVIORAL coverage lives in
// tests/farming_command_chain_online.test.ts; these literal pins guard the
// extraction itself: a member dropped in a merge resolution reds here by name
// instead of surfacing as a stale self mirror in a live session.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEAVY_SELF_CMDS, HEAVY_SELF_EVENTS } from '../../server/heavy_self';

// The FULL member sets as sorted literals (the wire-name doctrine: these are
// protocol-adjacent names, so each is pinned to a string the production set
// does not supply). Adding or removing a member is a deliberate policy change
// that edits this list in the same change; an absorb-resolution that silently
// drops ANY member reds here by exact diff.
const EXPECTED_CMDS = [
  'abandon',
  'accept',
  'applyTalents',
  'bank_buy_slots',
  'bank_deposit',
  'bank_withdraw',
  'buy',
  'buyback',
  'change_skin',
  'change_weapon_skin',
  'claim_event_skin',
  'convert_husks',
  'deleteLoadout',
  'dev_give',
  'dev_level',
  'discard',
  'equip',
  'equip_bag',
  'guild_bank_deposit',
  'guild_bank_withdraw',
  'harvestCorpse',
  'harvest_crop',
  'interact',
  'inv_move',
  'inv_sort',
  'lock_item',
  'loot',
  'mail_delete',
  'mail_read',
  'mail_send',
  'mail_take',
  'market_buy',
  'market_cancel',
  'market_collect',
  'market_list',
  'market_list_instance',
  'mount_toggle',
  'pet_feed',
  'pickup',
  'plant_crop',
  'prestige',
  'respec',
  'rift_enchant_item',
  'rift_socket_gem',
  'rift_upgrade_item',
  'saveLoadout',
  'selectTalentRow',
  'sell',
  'setSpec',
  'switchLoadout',
  'turnin',
  'unequip_bag',
  'unequip_item',
  'unequip_mech_chroma',
  'use',
  'vcup_bet',
];

const EXPECTED_EVENTS = [
  'commissionOrderResult',
  'deedUnlocked',
  'dismissPet',
  'enchantResult',
  'farmPlanted',
  'learnAbility',
  'levelup',
  'loot',
  'mailArrived',
  'mailResult',
  'mechChroma',
  'questAccepted',
  'questDone',
  'questProgress',
  'questReady',
  'reliquaryUnlock',
  'skinEvent',
  'skinSelect',
  'summonDemon',
  'summonPet',
  'tamePet',
  'toolEffectResult',
  'tradeDone',
  'unbindResult',
  'vcupBetSettled',
  'vendor',
  'virtualLevelUp',
];

describe('heavy-self policy sets', () => {
  it('HEAVY_SELF_CMDS is exactly the pinned set', () => {
    expect([...HEAVY_SELF_CMDS].sort()).toEqual(EXPECTED_CMDS);
  });

  it('HEAVY_SELF_EVENTS is exactly the pinned set', () => {
    expect([...HEAVY_SELF_EVENTS].sort()).toEqual(EXPECTED_EVENTS);
  });

  it('carries the farming members and the farming negatives', () => {
    // Named singly beside the exact-set pins so a farming regression reads as
    // a farming failure, not a 56-row diff.
    for (const cmd of ['plant_crop', 'harvest_crop', 'convert_husks']) {
      expect(HEAVY_SELF_CMDS.has(cmd), cmd).toBe(true);
    }
    expect(HEAVY_SELF_EVENTS.has('farmPlanted')).toBe(true);
    // farmDenied is deliberately NOT a member (refusals ride their own event
    // and must not buy a heavy re-serialize); pin the negative arm too.
    expect(HEAVY_SELF_EVENTS.has('farmDenied')).toBe(false);
  });

  it('server/game.ts still consumes the extracted sets (the orphan guard)', () => {
    // The membership pins above stay green on an orphaned module; this arm
    // fails if the coordinator stops importing the policy. A rename of the
    // import path or names is a deliberate change that edits this line.
    const game = readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8');
    expect(game).toContain("import { HEAVY_SELF_CMDS, HEAVY_SELF_EVENTS } from './heavy_self';");
  });
});
