// The two heavy-self re-diff triggers for the per-session snapshot gate
// (server/game.ts): which client COMMANDS and which sim EVENTS can change a
// heavy self field (bags, equipment, quest log, ...) and so force the next
// snapshot to re-serialize those fields. Moved out of game.ts verbatim to keep
// the coordinator under its monolith ceiling (tests/monolith_budget.test.ts);
// the dispatch flag site and the event fan-out site in game.ts are the only
// readers. Membership is observed behaviorally by the *_online wire tests.

export const HEAVY_SELF_CMDS = new Set<string>([
  'equip',
  'inv_move', // rewrites the inventory array order: the self snapshot must resend it
  'inv_sort', // consolidates stacks + restamps cell hints: the self snapshot must resend it
  'unequip_item',
  // salvage_item is deliberately ABSENT since the Craft Cast System: the
  // command only starts a cast (nothing mutates on receipt), and the
  // complete-time loot event is a HEAVY_SELF_EVENTS member, so listing it
  // here would buy a wasted heavy re-serialize per cast start.
  'rift_upgrade_item',
  'rift_enchant_item',
  'rift_socket_gem',
  'equip_bag',
  'unequip_bag',
  'use',
  'discard',
  'lock_item',
  'buy',
  'sell',
  'buyback',
  // Repair All (src/sim/durability.ts): the repaired copies lose their
  // durability field in place on the heavy-gated einst key, no loot event.
  'repair',
  // A Spirit Healer resurrection costs the worn gear a durability surcharge
  // in place (durability.ts), the same einst-only mutation as repair.
  'resurrect_healer',
  'loot',
  'harvestCorpse',
  'pickup',
  'interact',
  'accept',
  'turnin',
  'abandon',
  'applyTalents',
  'respec',
  'setSpec',
  'selectTalentRow',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
  'change_skin',
  'unequip_mech_chroma',
  'claim_event_skin',
  'mount_toggle',
  'change_weapon_skin',
  'prestige',
  'market_list',
  'market_list_instance',
  'market_buy',
  'market_cancel',
  'market_collect',
  'mail_send',
  'mail_take',
  'mail_delete',
  'mail_read',
  'bank_deposit',
  'bank_withdraw',
  'bank_buy_slots',
  // Bank bag sockets: the two ITEM MOVERS rewrite the carried inventory
  // (socketing consumes the carried bag copy, unsocketing addStacks it back,
  // and a swap does both), the heavy-gated `inv` key. bank_unlock_socket is
  // deliberately absent on vault_buy_upgrade's exact terms: copper rides the
  // ALWAYS-SENT base self object and the socket readouts ride the ungated
  // proximity `bank` key, so listing it would only buy a redundant heavy
  // re-serialize.
  'bank_socket_bag',
  'bank_unsocket_bag',
  // Materials Vault item moves: both rewrite the carried inventory (deposit
  // splices/decrements a slot, withdraw addStacks into it), the heavy-gated
  // `inv` key. vault_buy_upgrade is deliberately absent: copper rides the
  // ALWAYS-SENT base self object, and the vault view rides the ungated
  // proximity section beside 'bank', so listing it would only buy a redundant
  // heavy re-serialize (the guild bank's gold ops sit out for the same reason).
  'vault_deposit',
  'vault_withdraw',
  // The batched sweep rewrites the carried inventory like the two above, only
  // more so (up to every slot in one command).
  'vault_deposit_all',
  // Guild bank ops that touch a HEAVY self field: the two item moves rewrite
  // the carried inventory (heavy-gated `inv`). The gold ops and buy_slots are
  // deliberately absent: copper rides the ALWAYS-SENT base self object (not
  // the heavy gate) and the treasury/slots ride the ungated maybe('guildBank')
  // stream, so listing them would only buy a redundant heavy re-serialize.
  'guild_bank_deposit',
  'guild_bank_withdraw',
  'pet_feed',
  'dev_give',
  'dev_level',
]);
export const HEAVY_SELF_EVENTS = new Set<string>([
  'loot',
  // The death penalty writes durability onto the worn copies (durability.ts)
  // with no loot event, so the personal death event re-diffs einst itself.
  'playerDeath',
  'mailArrived',
  'mailResult',
  'levelup',
  'virtualLevelUp',
  'deedUnlocked', // the earned map + stat block ride the heavy-gated deeds/dstats keys
  // The Reliquary sparse blob (firstFind / illuminatedPages / marks / recent)
  // rides the heavy-gated `reliq` key. No saveCharacter on pure fill; since
  // Phase 18 the event is NOT presentation-only: detectActivity derives the
  // illumination marquee fan-out from its illuminatedPageId field.
  'reliquaryUnlock',
  'questAccepted',
  'questProgress',
  'questReady',
  'questDone',
  'learnAbility',
  'mechChroma',
  'skinEvent',
  'skinSelect',
  'tradeDone',
  'vendor',
  'tamePet',
  'summonPet',
  'dismissPet',
  'summonDemon',
  // The acquisition craft's slot/recharge outcome: a successful slot consumes
  // a charm copy and a successful recharge consumes arcane materials, neither
  // through a loot-event path, so the self inv mirror re-diffs off this event.
  // Deny arms ride along and force the same re-diff for no state change,
  // ACCEPTED as the family's standing shape: enchantResult/unbindResult are
  // members on the same terms, and HEAVY_SELF_CMDS already dirties on receipt
  // regardless of outcome, so a denial-spamming client buys nothing another
  // command does not already offer it.
  'toolEffectResult',
  // Maker's Bond unbind (Professions 2.0): a successful unbind can
  // clear boundTo IN PLACE (the single-copy arm emits no loot event), so the
  // result event itself must re-diff the heavy self keys or the holder's inv
  // mirror goes stale until the staggered refresh. Also refreshes the purse
  // for the fee debit.
  'unbindResult',
  // Apply-enchant, for the same reason as unbindResult above: the WORN arm
  // (src/sim/professions/enchanting.ts resolveApplyEnchantWorn) enchants in
  // place, so it only REMOVES reagents and emits no loot event. Without this the
  // enchant itself would show at once (it rides the `eqi` identity diff, which
  // recalcPlayerStats rebuilds) while the spent reagents lingered in the bag
  // mirror until the staggered refresh, and re-opening the picker could still
  // offer an enchant the player can no longer afford. The bagged arm's loot
  // event already covered it; this makes both arms explicit.
  'enchantResult',
  // Commission order board delivery (issue #1298): the crafter's arm
  // removes the delivered copy directly from PlayerMeta.inventory (no
  // addItem/removeItem call, so no loot event fires on that side), so the
  // result event itself must re-diff the crafter's heavy self keys or their
  // inv mirror goes stale until the staggered refresh. The requester's side
  // already gets a loot event from the ordinary addItemInstance grant.
  'commissionOrderResult',
]);
