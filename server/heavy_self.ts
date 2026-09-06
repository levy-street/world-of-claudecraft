// The heavy-self marking policy: which wire commands (on receipt) and which
// sim events (on routing) force a fresh heavy self re-serialize for the acting
// player's next snapshot. Both sets moved WHOLE from server/game.ts at the
// v0.38.0 fourteenth absorb (the monolith ratchet heal); behavior unchanged,
// and the membership doctrine lives on each entry, exactly as it did there.
export const HEAVY_SELF_CMDS = new Set<string>([
  'equip',
  'inv_move', // rewrites the inventory array order: the self snapshot must resend it
  'material_separate',
  'material_combine',
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
  // 'vcup_bet' (a copper debit) sat here until the Vale Cup retired with
  // release/v0.41.0 (1c74387b4c); the command no longer exists.
  // Farming's two plot mutations, added when `fplot` moved behind the heavy
  // gate. BELT AND BRACES, stated honestly rather than overclaimed: every
  // SUCCESSFUL plant spends a seed (the lock-aware walk fires
  // onInventoryChangedForQuests directly) and every successful harvest grants
  // produce or husks through ctx.addItem into the same hook, which bumps
  // meta.wireRev, which is itself a heavyDue input. So freshness on the paths that change anything is already
  // guaranteed without these two lines (verified by deleting each and watching
  // the end-to-end snapshot arms stay green).
  //
  // They earn their place by making that guarantee LOCAL to the command instead
  // of resting on the incidental fact that both commands happen to touch bags:
  // a future arm that mutates a plot without an inventory change (the knob
  // commands sketched for the next phase) would otherwise go stale for up to
  // one backstop interval with nothing in this file hinting why. The cost was
  // one spurious heavy re-serialize per REFUSED plant or harvest, the same
  // trade every member here makes ('use', 'equip' and friends all mark on
  // receipt regardless of outcome); since Phase 18 both are ARM-MARKED (see
  // HEAVY_SELF_ARM_MARKED_CMDS below), so a frame the dispatch's own type
  // guards refuse never marks, and only a frame that reaches the sim does.
  'plant_crop',
  'harvest_crop',
  // The knobs phase's husk conversion, the same belt-and-braces trade as the
  // pair above: a SUCCESSFUL conversion touches bags in both directions
  // (husks out through the lock-aware walk, compost in through ctx.addItem), so
  // wireRev already guarantees freshness on the path that changes anything,
  // and the loot event the compost grant rides is a HEAVY_SELF_EVENTS member
  // on top. The entry keeps the guarantee LOCAL to the command per the
  // ledgered comment above; arm-marked since Phase 18 like the pair above
  // (a frame that reaches sim.convertHusks marks, nothing else does). NOTE: the
  // PLANT-TIME KNOBS need no entry of their own because they are not
  // commands: they ride plant_crop's payload, whose membership already marks
  // on receipt, and a paid knob spends items (wireRev again).
  'convert_husks',
  // The shared feast's place verb spends one bag item on success (wireRev
  // covers that path); membership keeps the guarantee local to the command,
  // the same belt-and-braces trade as its farming siblings above, and it is
  // arm-marked with them (HEAVY_SELF_ARM_MARKED_CMDS below).
  // consume_feast deliberately has NO entry: a bite touches no bag state
  // (charges and the ledger are feast state, and the buff rides the aura
  // wire), so there is nothing heavy to refresh.
  'place_feast',
  // The Perfecting stage (Masterwrought phase 12): a resolved attempt spends
  // the three materials through the lock-aware bag walk and mutates the
  // target's instance payload IN PLACE (the bind stamp, the rank, the
  // Perfected marker and its stat merge), on a bagged copy (the `inv` mirror)
  // or a worn one (the `einst` mirror). No loot event fires on any arm, so
  // membership here is what re-diffs both mirrors on the next snapshot; the
  // sim's wireRev bump on the material spend covers the same path, and the
  // entry keeps the guarantee LOCAL to the command per the farming ledger
  // above. ARM-MARKED since Phase 18 (HEAVY_SELF_ARM_MARKED_CMDS below): a
  // malformed ref or a screened name is refused by the dispatch itself and
  // marks nothing; a frame that reaches sim.perfectItemAs marks, whatever
  // the sim's own deny ladder then decides.
  'perfect_item',
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

// The ARM-MARKED subset of HEAVY_SELF_CMDS (Phase 18, the perfect-item and
// farming refusal reads): members whose mark moves off the unconditional
// receipt line in dispatchMessage and INTO their dispatch arm, set only once
// the frame has passed the arm's own guards and the sim is actually invoked.
// The rift-forge refusal-above-flag idiom generalized: a frame the dispatch
// itself refuses (a malformed perfect_item ref, a screened legendary name, a
// farming frame whose bed/crop/knob fields fail their type guards) never
// buys a heavy self re-serialize. The trade every entry above still makes
// ("marks on receipt regardless of outcome") narrows for these five to
// "marks when the sim is called": a SIM-side refusal (the deny ladder, a
// farmDenied) still marks, because the dispatch cannot see the sim's verdict
// without a return channel the sim does not have, and the success paths keep
// their own belt-and-braces freshness (wireRev on every spend, the loot and
// farmPlanted events) exactly as the entries' own comments record.
export const HEAVY_SELF_ARM_MARKED_CMDS = new Set<string>([
  'perfect_item',
  'plant_crop',
  'harvest_crop',
  'convert_husks',
  'place_feast',
]);

/** Whether `cmd` marks the heavy self dirty at RECEIPT (the pre-switch line):
 *  every HEAVY_SELF_CMDS member except the arm-marked subset. */
export function heavySelfMarkOnReceipt(cmd: string): boolean {
  return HEAVY_SELF_CMDS.has(cmd) && !HEAVY_SELF_ARM_MARKED_CMDS.has(cmd);
}

/** Whether `cmd` marks the heavy self dirty in its ARM, once the frame is
 *  accepted (the sim is invoked): the arm-marked subset, and only members.
 *  Dropping a name from HEAVY_SELF_CMDS retires its mark on both paths. */
export function heavySelfMarkOnAccept(cmd: string): boolean {
  return HEAVY_SELF_CMDS.has(cmd) && HEAVY_SELF_ARM_MARKED_CMDS.has(cmd);
}

export const HEAVY_SELF_EVENTS = new Set<string>([
  'loot',
  // 'vcupBetSettled' (a copper credit) sat here until the Vale Cup retired with
  // release/v0.41.0 (1c74387b4c); the event no longer exists.
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
  // Farming's plant (the growth phase): a successful plant CONSUMES the seed
  // through ctx.removeItem, which emits no loot event, so without a mark the
  // spent seed would linger in the planter's mirror until the staggered
  // refresh and a quick second plant would read as a spurious no_seed bug.
  //
  // KEPT DELIBERATELY REDUNDANT with `plant_crop`'s HEAVY_SELF_CMDS membership,
  // which already covers every wire plant on receipt. This is the EVENT-side
  // guarantee, and it is what holds for any planting that does not arrive as
  // that command: a scripted or admin-driven plant, or a future quest step.
  // Setting an already-true boolean costs nothing, it fires ONLY on success
  // (every refusal rides the separate farmDenied event, deliberately NOT a
  // member), and tests/farming_command_chain_online.test.ts exercises it in
  // isolation by clearing the command-side mark before the tick, so the
  // redundancy stays live rather than rotting into a comment.
  //
  // The HARVEST side needs no entry: its produce and withered-husk grants go
  // through ctx.addItem, whose `loot` event is a member above and fires
  // unconditionally (the silent/callerLogs opts are payload flags for client
  // logging, not emission gates).
  'farmPlanted',
  // Farming's ready notice (the ready-notice phase), and the answer to the
  // one mutation the plant entry above could not cover: a plot ripening on
  // its own deadline. The 1 Hz sweep flips the plot's persisted `notified`
  // flag with no inventory change and no command behind it, so without a mark
  // the heavy-gated `fplot` row would sit at the staggered
  // HEAVY_SELF_REFRESH_TICKS backstop and the client's mirror would disagree
  // with the notice it just rendered: the client-visible field that goes
  // stale is the server-computed `status` (growing versus ready) the journal,
  // pins, and beds all key on; the flipped `notified` byte is what makes the
  // row differ so the diff gate fires at all. It fires only when a
  // plot actually transitioned (the flag makes it once-per-cycle), so this
  // buys at most one re-diff per growth cycle per farmer.
  'farmReady',
]);
