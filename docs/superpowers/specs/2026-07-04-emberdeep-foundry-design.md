# Emberdeep Foundry: endgame dungeon in Thornpeak Heights (design)

Date: 2026-07-04
Status: approved by maintainer (brainstorm session), pending implementation plan

## Summary

A fully themed 5-player endgame dungeon (levels 18 to 20) in zone 3, Thornpeak
Heights: the Emberdeep Foundry, the mountain clans' old forge under the southwest
crags, relit by an ember cult. Pre-raid-best rewards: top-end rares plus one epic
per class archetype from the final boss, slotting under Nythraxis raid loot.
Built on the temple.ts pattern: one self-contained content module, a new interior
layout, a new renderer interior variant reusing the temple liquid shader retinted
to magma, a 7-quest surface chain, and full test coverage. No instance-system or
sim-engine code changes.

## Decisions made in the brainstorm

- Scope: fully themed dungeon (unique visuals plus quest chain), not a reskin.
- Theme: Emberdeep Foundry (fire and forge), over storm-aerie and frost-barrow
  alternatives.
- Position: endgame, levels 18 to 20, alongside Gravewyrm Sanctum in the zone
  finale band.
- Door site: past Drogmar's War-Camp, approximately (-150, 770) (site C of the
  three candidates; gives the ogre war-camp a lore reason and a guarded
  approach). Exact position is nudged by findSafePos at spawn.
- Loot tier: pre-raid best. Better than Gravewyrm Sanctum drops, strictly under
  raid drops. The classic "gear here to enter the raid" role.

## 1. Fantasy and narrative hook

The Foundry is the old forge of the mountain clans, dug under the southwest
crags and long cold. An ember cult has relit it; whatever they are forging is
why the deep halls glow again. Drogmar's ogres did not camp at the doorstep by
choice: they were driven out of the deep halls. This retroactively explains the
existing war-camp POI and ties the dungeon into the zone's standing conflicts.

## 2. Registration (data only)

- Dungeon id: emberdeep_foundry, display name "Emberdeep Foundry".
- DUNGEON_DEFS entry: index 10 (indexes 6-9 fall inside the reserved
  arena/delve x-window [4200, 6600), so the dungeon band sequence resumes at
  10; 4 and 5 are the Nythraxis raid wings), doorPos near
  (-150, 770), entry/exitOffset following the temple's convention,
  suggestedPlayers 5, enterText/leaveText flavor lines.
- Merged in src/sim/data.ts alongside TEMPLE_DUNGEON_DEFS. The instance system
  (src/sim/instances/dungeons.ts) needs zero changes; door triggers, party
  instancing, spawn lifecycle, and despawn are data-driven off DUNGEON_DEFS.

## 3. Interior layout

Three chambers on the standard kit (side walls at |x| = 23), about 45 lines in
src/sim/dungeon_layout.ts; collision derives from layoutColliders() with no
bespoke collider code:

- Assembly hall (z 0 to 48): entry chamber, trash packs, magma channels along
  the walls.
- Casting halls (z 48 to 96): mid chamber behind a chamber-waist stub wall;
  Kilnmaster Vorr (mid-boss) plus cultist packs; central pillar rows.
- Forge heart (z 96 to 130): final chamber behind a second stub; the Slagheart
  Colossus on a boss dais at approximately z 118.

The magma channels use the layout kit's wall-side obstacle slot (the temple uses
it for reliquary altars), so they block movement and render as glowing slag.

## 4. Mobs and bosses

Seven elite mob types plus two bosses, all levels 18 to 20, stat curves mirrored
from Gravewyrm Sanctum's elites (no invented balance numbers):

- Cultists: cinderpriest (caster), kiln acolyte.
- Constructs: emberbound custodian, forgeguard sentinel.
- Creatures: slag hound, ash revenant, molten crucible-tender.
- Mid-boss: Kilnmaster Vorr, the cult leader. Summons cinder-wisp adds
  (summonAdds) and soft-enrages (enrage).
- Final boss: the Slagheart Colossus, an awakened forge golem. Slag-eruption
  pulses (aoePulse) and an enrage.

All mechanics come from the existing MobTemplate mechanics vocabulary (aoePulse,
summonAdds, enrage). No new engine mechanics, no scripted encounter module.

## 5. Loot and quests

- Trash and Vorr: top-end rares via loot rollGroups, above Sanctum's rare
  budget, below epics.
- Slagheart Colossus: one epic per class archetype using the existing
  requiredClass archetype groups (WAR/MAG/ROG), on the same item budget as the
  already-shipped grindable T1 epics. Plus junk slag vendor trash.
- Quest chain: 7 quests (two parallel mid-chain branches). Giver in Highwatch, a staging step at the war-camp
  front, cult sabotage objectives inside the instance, finale "fell the
  Slagheart Colossus" (suggestedPlayers 5). Follows the temple chain's shape
  (requiresQuest links, minLevel gates).

## 6. Visuals (renderer)

- New DungeonInteriorVariant 'foundry' in src/render/dungeon.ts.
- TORCH_COLORS entry: basalt gray, ember orange, forge gold palette.
- Magma channels reuse the temple's liquid shader retinted (emissive ember,
  slower flow), which was the temple's single most expensive piece and is
  nearly free to reuse.
- Standard mesh kit otherwise; no new model work required for the interior.

## 7. Wiring and i18n obligations

- src/sim/types.ts: add 'foundry' to the interior union.
- src/sim/data.ts: merge the module's mobs/npcs/quests/items/camps/defs.
- src/ui/world_entity_i18n.ts: add the dungeon id, all mob/NPC ids, and all
  quest ids to the parallel id lists (English source of truth).
- Any sim-emitted player text (enterText/leaveText, quest flavor) follows the
  temple precedent and registers in the sim_i18n matcher in the same change
  (S3 guard enforces this).
- npm run wiki:content regen committed (guide freshness gate), plus guide
  stills for any new creature visual via npm run wiki:stills.
- English only; the 20 locale overlays are never edited (maintainer fills at
  release). Wordy new English values follow the M16 rule if it applies.

## 8. Testing and verification

- tests/foundry.test.ts mirroring tests/temple.test.ts: dungeon registered at
  the right index and origin, full spawn set materializes on entry, interior
  collision is solid (walls and stubs block, dais walkable), boss mechanics
  fire, loot roll groups resolve, quest chain hangs together and ends on the
  boss kill.
- Determinism: same-seed double-run equality; a tests/parity scenario if the
  change adds rng draws in shared paths.
- Guards: tests/architecture.test.ts (sim purity), the S3 i18n guard
  (tests/localization_fixes.test.ts), tests/guide.test.ts (wiki freshness).
- Manual test recipe (offline, dev cheats are auto-enabled in npm run dev):
  /dev level 20, /dev tp -150 770, walk into the door; /dev give <itemId> to
  inspect loot; /dev quest <questId> to fast-forward the chain; /dev kill to
  test the death loop inside the instance.

## 9. Effort estimate

About 1,000 lines across roughly 15 files (based on the temple's real 989-line
commit), 2 to 3 working sessions: content module and layout first, then
renderer variant, then quests/i18n/guide, then tests.

## Out of scope

- No scripted multi-phase encounter module (that is raid-tier machinery).
- No new mob models; retints and existing families only.
- No new engine mechanics or instance-system changes.
- No profession hooks (the professions PRD track is separate).
