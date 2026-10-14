// Identity projection shared by full snapshots and cached entity records.

import { hasStreamerLink } from '../src/sim/account_flair';
import type { Entity } from '../src/sim/types';
import { equippedInstanceWire } from './equipped_instance_wire';
import { writePlayerIdentityWire } from './player_identity_wire';

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
    // also exposes loot quality; binding and custody stay private.
    const eqi = equippedInstanceWire(e);
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
  writePlayerIdentityWire(e, out); // guild, pledge, guild tier, deed title/border, spec
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.riftTier) out.rt = e.riftTier; // ranked rift portal badge (render-only)
  if (e.vaultRarity) out.vr = e.vaultRarity; // buried-hoard rarity (render-only)
  if (e.objectItemId) out.obj = e.objectItemId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  return out;
}
