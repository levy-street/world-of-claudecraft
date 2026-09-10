import { hasStreamerLink } from '../src/sim/account_flair';
import { lootHasGoneFfa } from '../src/sim/loot/loot_ffa';
import { corpseHasDecayed } from '../src/sim/respawn_policy';
import { threatEntries } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { wireAura } from './snapshot_timer_wire';
import { round2 } from './tick_perf_log';

// Identity fields rarely change, so they ride only in "full" records: on an
// entity's first snapshot for a session and again whenever one of them
// changes. The client treats their absence in a record as "unchanged".
function identityFields(e: Entity): Record<string, unknown> {
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
  if (e.mountSkinId) out.msk = e.mountSkinId; // worn mount-skin cosmetic (render-only, like wsk)
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
    // Data minimization: only the inspect fields (signer, enchant, rolled,
    // name, perfected, and a Riftbound band's rift record: its rank, upgrades,
    // and gems, which the band tooltip's item level and rank lines read) leave
    // the server; boundTo, charges, and the bindOnTrade arm are gameplay state
    // no inspecting client needs and never ride this key. The pub allowlist
    // below is what enforces this, so a new non-cosmetic ItemInstancePayload
    // field is excluded by construction; the owner still sees their own
    // payload in full via the self `inv` mirror. 2026-08-27: `name` (the
    // player-chosen legendary name, Masterwrought phase 13) is the FIRST
    // cosmetic JOIN since the rule was written. The visible Perfected marker
    // now lets inspect resolve active versus dormant enchants accurately.
    let eqi: Record<string, unknown> | undefined;
    for (const [slot, inst] of Object.entries(e.equippedInstances)) {
      if (!inst) continue;
      const pub: Record<string, unknown> = {};
      if (inst.signer !== undefined) pub.signer = inst.signer;
      if (inst.enchant !== undefined) pub.enchant = inst.enchant;
      if (inst.rolled !== undefined) pub.rolled = inst.rolled;
      if (inst.name !== undefined) pub.name = inst.name;
      if (inst.perfected === true) pub.perfected = inst.perfected;
      if (inst.rift !== undefined) pub.rift = inst.rift;
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
  if (e.pledgeGuild) out.pg = e.pledgeGuild; // guild pledge (display only; '' for members)
  if (e.guildTier) out.gt = e.guildTier; // guild colour tier (sim/guild_tier.ts)
  if (e.title) out.title = e.title; // Book of Deeds active title (a deed id; the client localizes)
  if (e.border) out.border = e.border; // Book of Deeds nameplate border (a deed id; the client resolves the slug)
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.riftTier) out.rt = e.riftTier; // ranked rift portal badge (render-only)
  if (e.objectItemId) out.obj = e.objectItemId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  return out;
}

// Dynamic fields are re-sent whole in every full or lite record, so the
// conditional ones keep their absent-means-unset semantics.
function dynamicFields(e: Entity, includeAuras = true): Record<string, unknown> {
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
  // Target/target-of-target swing-timer bar: the general (non-self) mirror of
  // the self-only `swing` field above selfWireJson, gated on autoAttack so an
  // idle entity costs nothing extra on the broadcast (same style as the
  // castingAbility gate above it). No weapon-speed field rides with it: the
  // client's targetSwingTimerState degrades gracefully to the raw swingTimer
  // as its first-frame period guess, self-correcting at the next swing-reset
  // edge, trading one swing's worth of first-frame fill accuracy for not
  // adding a second field to every broadcast tick for every auto-attacking
  // entity in interest range.
  if (e.autoAttack) out.swing = round2(e.swingTimer);
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
  // Vaulting Charge (heroic_leap): same family as the ledge climb above (it
  // owns movement outright while it runs, src/sim/combat/heroic_leap.ts). A
  // bare presence bit, not the arc: the client never re-simulates the leap,
  // it only needs to know one is running so the self-extrapolator stops
  // predicting ordinary grounded movement over the airborne arc.
  if (e.leap) out.lp = 1;
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
  if (e.kind === 'mob' && corpseHasDecayed(e.dead, e.corpseTimer)) out.cd = 1; // corpse decayed
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

export { dynamicFields, identityFields };
