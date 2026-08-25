// The per-entity wire serializers: one Entity in, the JSON-shaped record every client
// receives out.
//
// Lifted out of game.ts as one coherent concern: identity fields (who this is: template,
// name, cosmetics, held models), dynamic fields (where it is and what it is doing this
// tick), and the aura projection, plus the rounding that keeps an idle entity's record
// byte-stable so the per-entity serialization cache can elide it. Every new wire-visible
// entity fact lands HERE, never inline in the broadcast loop; the field comments are the
// wire contract's documentation, and src/net/online.ts applySnapshot is its other half.

import {
  type AccountFlair,
  type ChatSenderFlair,
  hasStreamerLink,
  wireStreamerLinks,
} from '../src/sim/account_flair';
import { lootHasGoneFfa } from '../src/sim/loot/loot_ffa';
import { isPersistentEngineAura } from '../src/sim/persistent_aura';
import { threatEntries } from '../src/sim/threat';
import type { Aura, Entity } from '../src/sim/types';

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Round a Shardpike guidance view for the wire.
 *
 * The only float in it is the distance to the boss, and a WALKING player changes that every
 * tick by a few thousandths. The `maybe` delta compares JSON, so an unrounded distance makes
 * this "changed" on literally every tick of every pike-carrying session, which is the exact
 * shape of the per-tick re-ship the delta registry exists to prevent. Whole yards: the
 * prompt says "walk closer", it does not need centimetres.
 */
export function roundLanceGuidance<T extends { targetDistance: number | null }>(
  view: T | null,
): T | null {
  if (!view) return null;
  const d = view.targetDistance;
  return d === null ? view : { ...view, targetDistance: Math.round(d) };
}

export interface WireAura {
  id: string;
  name: string;
  kind: string;
  rem: number;
  dur: number;
  perm?: 1;
  // The aura's magnitude, so buff/debuff hover tooltips show the REAL numbers online, exactly
  // as offline (the descriptor in src/ui/aura_effect.ts reads value per kind: flat stat amount,
  // slow/haste multiplier, dot/hot per-tick, absorb remaining, ...). Sent RAW (like `dur`, not
  // round2) so the exact number and its sign survive JSON: round2 could turn a tiny negative
  // into -0 -> 0 and flip a stat-sap's isAuraDebuff classification. Omitted only when exactly 0,
  // which decodes back to 0, so value-less auras and an old server are unchanged.
  value?: number;
  // Optional secondary aura values: imbue judgement's min/max damage range and
  // Greater Invisibility's reduction/aftereffect duration.
  value2?: number;
  value3?: number;
  // dot/hot tick cadence in seconds, so the tooltip's "every N sec" is right online.
  tickInterval?: number;
  // damage/heal school for dot/absorb/thorns tooltips. Physical is the client's decode default,
  // so only a non-physical school needs to ride the wire.
  school?: string;
  stacks?: number;
  // Remaining charges on a charge-limited aura (Lightning Shield's reflect count). Sent only
  // when defined, so ordinary auras stay off the wire and decode to undefined as before; the
  // client badge prefers this over stacks (auras_view). A pure cosmetic count, not actionable
  // information a graphics preset could hide, so it rides the wire unconditionally when present.
  charges?: number;
  // Next-cast empowerment scope. Omitted for unscoped empowerment auras, which match any
  // eligible cast just like the sim helper.
  emp?: string[];
  // The caster's entity id, so the client's target strip can lead with and enlarge the
  // viewer's OWN dots/hots (auras_view ownFirst). A shared per-entity value (never
  // per-viewer), so the per-entity dyn cache keeps eliding; an old client ignores it and
  // an old server's omission decodes to 0, which matches no player id.
  src?: number;
  // Encounter-owned control marker. Omitted for ordinary auras.
  ub?: 1;
  // No-player-counter-may-shed marker (the recovery sicknesses). Presence only: the
  // client reads it through the same isPlayerRemovableAura predicate the sim uses, so
  // the buff bar never offers a right-click cancel the server would refuse. Omitted for
  // ordinary auras, and an old server's omission decodes to undefined, as before.
  und?: 1;
  // Break-threshold ARMED marker (Lingering Dread's soak-before-snap fear):
  // presence only, never the live soak value - the number decrements per hit
  // and would churn the stable aura cache, while the client (the victim-worn
  // dread band in src/render/ability_vfx) only keys on whether the talent
  // armed the fear at all. Omitted for ordinary auras.
  bt?: 1;
}

export function wireAura(a: Aura): WireAura {
  const permanent = a.permanent === true;
  const w: WireAura = {
    id: a.id,
    name: a.name,
    kind: a.kind,
    rem: permanent ? LEGACY_PERMANENT_AURA_SECONDS : round2(a.remaining),
    dur: permanent ? LEGACY_PERMANENT_AURA_SECONDS : a.duration,
  };
  if (permanent) w.perm = 1;
  // Carry the aura's magnitude so buff/debuff hover tooltips show the real numbers online,
  // not 0 (the descriptor in src/ui/aura_effect.ts reads value per kind). Sent RAW (like
  // `dur`, not round2) so the exact number and its sign survive JSON, keeping a negative
  // stat-sap's isAuraDebuff classification intact (round2 could turn a tiny negative into
  // -0 -> 0). Omitted only when exactly 0, which decodes back to 0, so value-less auras and
  // an old server are unchanged. A hover tooltip magnitude is non-actionable cosmetic text,
  // so sending it cannot let a graphics preset hide anything (graphics-settings fairness).
  if (a.value !== 0) w.value = a.value;
  // Optional secondary aura values (imbue range or Greater Invisibility aftereffect);
  // dot/hot cadence; non-physical school. Each rides only when it carries meaning, so
  // ordinary auras stay lean and decode to their defaults.
  if (a.value2 !== undefined) w.value2 = a.value2;
  if (a.value3 !== undefined) w.value3 = a.value3;
  if (a.tickInterval !== undefined) w.tickInterval = a.tickInterval;
  if (a.school !== 'physical') w.school = a.school;
  // Stacks are omitted below 2 as a sparsity rule, EXCEPT for the persistent
  // engine banks (druid/shaman/hunter spec engines): their badge and tooltip
  // teach the live stage including 0 and 1, and the decode side cannot tell
  // "absent because 1" from "absent because 0", so the count is always sent.
  if (isPersistentEngineAura(a.id)) w.stacks = a.stacks ?? 0;
  else if (a.stacks && a.stacks > 1) w.stacks = a.stacks;
  // Carry the remaining charges only for a charge-limited aura (Lightning Shield), so the
  // buff icon can badge the count online exactly as offline; undefined for every other aura.
  if (a.charges !== undefined) w.charges = a.charges;
  // Next-cast empowerment scope. Omitted for unscoped empowerment auras, which match any
  // eligible cast just like the sim helper.
  if (a.empowerAbilities !== undefined) w.emp = a.empowerAbilities;
  // The caster's entity id, for the client's own-aura prominence on the target strip
  // (auras_view ownFirst). Omitted for the rare 0/absent source, which decodes to 0.
  if (a.sourceId) w.src = a.sourceId;
  if (a.unbreakableControl) w.ub = 1;
  if (a.undispellable) w.und = 1;
  if (a.breakThreshold !== undefined) w.bt = 1;
  return w;
}

export function identityFields(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { k: e.kind, tid: e.templateId, nm: e.name, lv: e.level };
  if (e.skinCatalog === 'mech') out.cat = 'mech';
  if (e.skin) out.sk = e.skin;
  // Active rideable mount ('' omitted). This identity field is intentionally
  // distinct from the self-only persisted pick (`mntSel`): using `mnt` for both
  // made the appended self delta overwrite the live riding state in JSON.
  if (e.mountKey) out.mnt = e.mountKey;
  if (e.mainhandItemId) out.mh = e.mainhandItemId; // equipped mainhand → held weapon model (render-only)
  if (e.offhandItemId) out.oh = e.offhandItemId; // equipped offhand → held weapon model (render-only)
  if (e.weaponSkinId) out.wsk = e.weaponSkinId; // active weapon-skin cosmetic (render-only, like mh)
  // Full worn set, for the inspect-another-player window. Players only and only
  // when something is equipped; rides the identity record (first appearance +
  // on change), never the per-tick dynamic fields. Render-only, like `mh`.
  if (e.kind === 'player') {
    // The authored modular look (`app`) is NOT built here. It is ~0.6 KB for a
    // default look (1489 bytes at its hard bound, APPEARANCE_MAX_WIRE_BYTES)
    // and changes at most once a session, and everything in this record is
    // JSON.stringify'd once per entity per TICK (wireCacheFor), so composing it
    // into the object would re-serialize half a kilobyte 20 times a second per
    // online player to produce the same bytes. It is serialized once per entity
    // instead (EntityWireCache.appJson) and spliced into the cached identity
    // JSON; the self record picks it up through the `maybeRaw` delta channel in
    // bcastSelf, which already exists for heavy, rarely-changing fields.
    // appearanceWireJson() is the one place that string is minted.
    const eq = e.equippedItems;
    for (const _ in eq) {
      out.eq = eq;
      break;
    }
    // Per-slot ItemInstancePayloads of the worn set (masterwork/enchant rolls),
    // for the inspect window (Professions 2.0). Same sparse rule as
    // `eq` above: players only, only when at least one worn piece carries a
    // payload, riding the identity record (wireCacheFor diffs the identity
    // JSON, so an equip/unequip of an instanced piece re-emits automatically).
    // Data minimization: only the cosmetic inspect fields (signer, enchant,
    // rolled) leave the server; boundTo, charges, and the bindOnTrade
    // arm are gameplay state no inspecting client needs and never ride this key.
    // The pub allowlist below (signer/enchant/rolled ONLY) is what enforces this,
    // so a new non-cosmetic ItemInstancePayload field is excluded by construction;
    // the owner still sees their own payload in full via the self `inv` mirror.
    let eqi: Record<string, unknown> | undefined;
    for (const [slot, inst] of Object.entries(e.equippedInstances)) {
      if (!inst) continue;
      const pub: Record<string, unknown> = {};
      if (inst.signer !== undefined) pub.signer = inst.signer;
      if (inst.enchant !== undefined) pub.enchant = inst.enchant;
      if (inst.rolled !== undefined) pub.rolled = inst.rolled;
      for (const _ in pub) {
        if (eqi === undefined) eqi = {};
        eqi[slot] = pub;
        break;
      }
    }
    if (eqi) out.eqi = eqi;
  }
  if (e.holderTier) out.ht = e.holderTier; // $WOC holder-tier flair (cosmetic)
  if (e.holderBalance) out.hb = Math.round(e.holderBalance); // exact $WOC, for inspect
  if (e.discordTier) out.dt = e.discordTier; // Discord status-tier flair (cosmetic)
  if (e.discordAvatar) out.dav = e.discordAvatar; // Discord PFP (linked indicator)
  if (e.discordName) out.dnm = e.discordName; // Discord handle / nickname (nameplate)
  if (e.discordJoined) out.dj = e.discordJoined; // Discord join epoch ms (member since)
  if (e.discordRole) out.dr = e.discordRole; // top staff/special role key (name color + tag)
  if (e.devTier) out.dvt = e.devTier; // developer-badge tier (cosmetic)
  if (e.devMergedPrs) out.dvc = e.devMergedPrs; // merged-PR count, for inspect/card
  if (e.githubLogin) out.dgl = e.githubLogin; // GitHub login (inspect readout + profile link)
  // Curator standing (cosmetic): rank plus the character-scoped completion pair
  // behind it, for the inspect card's Reliquary line and the rank-5 sigil.
  // Sparse like the flair above: refreshCuratorStanding only stamps them for a
  // ranked character, so an unranked player ships nothing and a full record
  // with the keys absent resets the mirror. The pair NESTS under the rank so
  // all-or-nothing is structural at the encoder, not a convention the
  // refresher must remember.
  if (e.curatorRank) {
    out.crk = e.curatorRank; // Curator rank 1-5
    if (e.relicsOwned) out.cro = e.relicsOwned; // character-scoped relics owned
    // relicsTotal is the one player-INDEPENDENT number of the three: it is the
    // character-scoped catalog size, so a client could derive it from its own
    // content tables and never ask. It rides the wire anyway because a
    // MIXED-VERSION client must not print a total that disagrees with the
    // server's catalog: the denominator on the card is whatever the server counted
    // when it stamped the pair, so an older or newer client shows the server's
    // completion rather than a locally-derived one that quietly differs.
    if (e.relicsTotal) out.crt = e.relicsTotal; // character-scoped relic total
  }
  if (e.aiAccount) out.ai = 1; // operator-set AI-operated mark (name prefix)
  // Operator-applied Cheater tag. A bare flag, not the remaining budget: every
  // nearby client needs to RENDER the tag, but only the wearer needs the
  // countdown, and the wearer already has it on the mark's own aura.
  if (e.cheaterMark) out.chm = 1;
  // Official streamer's platform links (player menu). Already gated by
  // wireStreamerLinks at the point they were set on the entity, so an account whose
  // streamer flag is off has none here, whatever is stored against it.
  if (e.streamerLinks && hasStreamerLink(e.streamerLinks)) out.slk = e.streamerLinks;
  if (e.guild) out.gd = e.guild;
  if (e.title) out.title = e.title; // Book of Deeds active title (a deed id; the client localizes)
  if (e.border) out.border = e.border; // Book of Deeds nameplate border (a deed id; the client resolves the slug)
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.riftTier) out.rt = e.riftTier; // ranked rift portal badge (render-only)
  if (e.objectItemId) out.obj = e.objectItemId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  return out;
}

/**
 * The flair a chat line carries for its SENDER, or undefined when the account has
 * none, so an ordinary player's chat event is byte-unchanged on the wire. The links
 * run through the same wireStreamerLinks gate the entity encoding uses: an account
 * whose streamer flag is off ships no links here either, whatever is stored.
 */
export function chatSenderFlair(flair: AccountFlair): ChatSenderFlair | undefined {
  const links = wireStreamerLinks(flair);
  if (!flair.ai && !links) return undefined;
  const out: ChatSenderFlair = {};
  if (flair.ai) out.ai = true;
  if (links) out.links = links;
  return out;
}

// Builds one aura's wire record via direct assignment rather than chained
// conditional spreads (`...(cond ? {...} : {})`), which allocated a throwaway
// object literal per branch regardless of which side taken. This runs for
// every aura on every entity every tick (dynamicFields below is unconditional
// per-entity, per-tick, even when wireCacheFor's diff ends up eliding the
// result), so at raid-sized entity/aura counts and 20 Hz the spread form was a
// measurable source of short-lived garbage. Output is byte-identical to the
// prior spread chain; only the allocation shape changed.
// A pre-v3 recipient ignores `perm`. Give it a large finite timer that is
// refreshed by ordinary legacy aura snapshots, so rolling deploys keep the
// aura visible instead of decoding the v3 sentinel as already expired.
const LEGACY_PERMANENT_AURA_SECONDS = 7 * 24 * 60 * 60;

// Dynamic fields are re-sent whole in every full or lite record, so the
// conditional ones keep their absent-means-unset semantics.
export function dynamicFields(e: Entity, includeAuras = true): Record<string, unknown> {
  const out: Record<string, unknown> = {
    x: round2(e.pos.x),
    y: round2(e.pos.y),
    z: round2(e.pos.z),
    f: round2(e.facing),
    hp: e.hp,
    mhp: e.maxHp,
  };
  if (e.dead) out.dead = 1;
  if (e.ghost) out.gh = 1; // released spirit (ghost form); renders translucent
  if (e.lootable) out.loot = 1;
  if (e.hostile) out.h = 1;
  if (e.afk) out.ak = 1; // /afk display bit: other clients tag the nameplate + presence dot
  if (e.bracing) out.brc = 1; // Shardpike couched (lance_trial.ts): remote clients pose the brace
  // A slumbering world boss in bed (mob/slumber.ts): remote rigs lie down and wake with him.
  if (e.asleep) out.slp = 1;
  // Warpath circuit phase (mob/warpath.ts), for the phase aura and travel cues a raid
  // reads the fight by (balgath_aura_core.ts). Omitted for every mob without one; the
  // unharried clock rides only while he travels, which is the only phase that reads it.
  if (e.warpathPhase) {
    out.wp = e.warpathPhase;
    if (e.warpathPhase === 'travel' && e.warpathUnharried) out.wu = round2(e.warpathUnharried);
  }
  // The target frame's resource bar: type + current/max, sent only for entities
  // that HAVE a resource (players and caster mobs; a resource-less wolf omits all
  // three and the frame hides its bar). The rounded res keeps an idle entity's
  // serialized record byte-stable so the per-entity dyn cache keeps eliding; the
  // SELF record still overrides with its own precise res/mres/rtype fields.
  if (e.resourceType) {
    out.rtype = e.resourceType;
    out.res = Math.round(e.resource);
    out.mres = e.maxResource;
  }
  if (e.castingAbility) {
    out.cast = e.castingAbility;
    out.castRem = round2(e.castRemaining);
    out.castTot = round2(e.castTotal);
    if (e.castTargetId !== null) out.castTgt = e.castTargetId;
    if (e.channeling) out.chan = 1;
  }
  // Mount summon/dismount transition, so every client can time the summon FX / call
  // pose and the self-extrapolator can root the local player in lockstep. Volatile
  // (rides the per-tick dynamic fields, not identity): mcr omitted when idle (0), mck
  // omitted while dismounting or idle (''). The sim reads mountCastRemaining (movement
  // root), so it is actionable and always rides when non-zero.
  if (e.mountCastRemaining) out.mcr = round2(e.mountCastRemaining);
  if (e.mountCastKey) out.mck = e.mountCastKey;
  if (e.sitting || e.eating || e.drinking) out.sit = 1;
  if (e.riftSliding) out.sld = 1; // ice-slide: render a frozen gliding pose
  // Ledge climb: quantized progress (1..99), not the arc. The client never
  // re-simulates the pull (the server owns it and streams the resulting
  // positions); it needs to know a climb is running, to stop predicting a
  // fall, and how far through it is so the pull-up pose tracks the motion.
  // Any non-zero value reads as "climbing" on older clients.
  if (e.climb) {
    const t = e.climb.elapsed / e.climb.duration;
    out.cl = Math.max(1, Math.min(99, Math.round(t * 100)));
  }
  if (e.weaponStowed) out.ws = 1; // Z-key sheathe: weapons render on the back
  if (e.helmHidden) out.hh = 1; // paperdoll eye toggle: kit helm left off the composed body
  if (e.aggroTargetId !== null) out.aggro = e.aggroTargetId;
  if (e.forcedTargetId !== null) out.ft = e.forcedTargetId;
  if (e.forcedTargetTimer > 0) out.ftm = round2(e.forcedTargetTimer);
  // A player's/bot's SELECTED target (mobs use aggroTargetId above): rides so the
  // client can render the target-of-target frame for a PLAYER target, exactly as
  // `aggro` already enables it for a mob/pet target. Emitted only for an entity that
  // HAS a target (players/bots in combat), so idle mobs (targetId stays null) add
  // nothing. The SELF record still carries its own precise `target` field.
  if (e.targetId !== null) out.tgt = e.targetId;
  if (e.tappedById !== null) out.tap = e.tappedById;
  // corpse harvest claim (single-use, first-come): the online corpse picker
  // must stop offering a corpse another player already harvested
  if (e.harvestClaimedBy !== null) out.hcb = e.harvestClaimedBy;
  // loot owner-lock lapse (FFA): the online corpse picker must offer a
  // stranger's aged-out corpse again for a deliberate manual loot, the same
  // reliability contract hcb gives harvest claims. Flips once per corpse, so
  // the per-entity dyn cache re-serializes exactly one changed record.
  if (e.kind === 'mob' && e.lootable && lootHasGoneFfa(e.lootFfaTimer)) out.ffa = 1;
  if (e.ownerId !== null) out.own = e.ownerId;
  if (e.overheadEmoteId) {
    out.emo = e.overheadEmoteId;
    out.emoSeq = e.overheadEmoteSeq;
  }
  if (e.ownerId !== null) {
    out.pm = e.petMode;
    out.pt = round2(e.petTauntTimer);
    if (e.petAutoTaunt) out.pa = 1;
    if (e.petAutoWaterJet) out.pw = 1;
    if ((e.petSkillTimer ?? 0) > 0) out.ps = round2(e.petSkillTimer ?? 0);
    if (e.petAutoSkill) out.px = 1;
  }
  if (e.rangedPower) out.rp = e.rangedPower;
  // Remote Paladins need the compact active-charge count so every client can
  // render Ascension's orbiting seals. Self snapshots additionally carry pdev
  // with the exact Devotion value and remaining duration for the local HUD.
  if (e.kind === 'player' && e.templateId === 'paladin') {
    // Omit-when-default like the fields above (review 3050): the idle 0 was
    // serialized into every snapshot for every remote paladin.
    const ascensionCharges = e.paladinDevotion?.ascensionCharges ?? 0;
    if (ascensionCharges > 0) out.pasc = ascensionCharges;
  }
  // top hate-table entries so the party threat meter shows real numbers
  if (e.kind === 'mob' && !e.dead && e.threat.size > 0) out.thr = threatEntries(e, 8);
  if (includeAuras && e.auras.length > 0) {
    out.auras = e.auras.map(wireAura);
  }
  if (e.kind === 'mob' && e.lootable && e.loot) {
    out.lootList = { copper: e.loot.copper, items: e.loot.items };
  }
  return out;
}

export function wireEntity(e: Entity, includeAuras = true): Record<string, unknown> {
  return { id: e.id, ...identityFields(e), ...dynamicFields(e, includeAuras) };
}
