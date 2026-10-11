// Recovery points inside defeated boss arenas, in route priority order.
// Wing arenas unlock independently; deeper linear arenas require their
// predecessors too.
//
// `gates` is the way in: the dungeon's own gates (DungeonDef.gates ids) a group
// walks through from the door to the point. The point is offered only while
// every one of them is open, so no checkpoint crosses a gate into a section the
// group has not cleared, however its boss came to be dead. Every route ends in
// the pack gate of the arena's own section; a gate that opens on a boss alone
// is listed only when that boss is one the row already asks for. Where two twin
// gates open on the same condition (the Chain Stairs, the Court Stairs), one of
// them is listed. tests/dungeon_checkpoints.test.ts walks each route on the
// real colliders: the listed gates reach the point, and none of them is spare.
import { DROWNED_TEMPLE_ANCHORS } from './drowned_temple_layout';
import { GRAVEWYRM_SANCTUM_ANCHORS } from './gravewyrm_sanctum_layout';
import { HOLLOW_CRYPT_ANCHORS } from './hollow_crypt_layout';
import { SUNKEN_BASTION_ANCHORS } from './sunken_bastion_layout';
import { WILDHEART_BASIN_ANCHORS } from './wildheart_basin_layout';

export interface DungeonCheckpoint {
  readonly bosses: readonly string[];
  readonly gates: readonly string[];
  readonly pos: { readonly x: number; readonly z: number };
}

// The Drowning Winch and its cage pit fill the centre of the Drowning Yard, so
// its point is the open floor this far south of it.
const DROWNING_YARD_SOUTH_OF_WINCH = 12;

export const DUNGEON_CHECKPOINTS: Readonly<Record<string, readonly DungeonCheckpoint[]>> = {
  hollow_crypt: [
    {
      bosses: ['sexton_marrow'],
      gates: ['grille', 'yard_barrier'],
      pos: HOLLOW_CRYPT_ANCHORS.bellYard,
    },
    // Through the Frost-Web Curtain, the wing's own pack gate. The Webbed
    // Causeway is the arena's second way in, but it falls with Rimeweb herself,
    // so it would prove nothing a dead Rimeweb does not.
    {
      bosses: ['rimeweb'],
      gates: ['grille', 'web_curtain'],
      pos: HOLLOW_CRYPT_ANCHORS.greatWeb,
    },
    {
      bosses: ['sexton_marrow', 'rimeweb', 'cantor_ilvane'],
      gates: ['grille', 'twin_seals'],
      pos: HOLLOW_CRYPT_ANCHORS.loft,
    },
    // Morthen's death begins the Knellwyrm finale, so the loft stays the
    // recovery point throughout that encounter rather than its Rite Ring.
  ],
  drowned_temple: [
    {
      bosses: ['choirmother_selthe'],
      gates: ['choir_veil'],
      pos: DROWNED_TEMPLE_ANCHORS.court,
    },
    {
      bosses: ['choirmother_selthe', 'tideglass_colossus'],
      gates: ['choir_veil', 'court_stair_east', 'prism_stair_rise', 'prism_ward'],
      pos: DROWNED_TEMPLE_ANCHORS.prismTerrace,
    },
  ],
  sunken_bastion: [
    {
      bosses: ['knight_commander_olen'],
      gates: ['sea_gate', 'bailey_drawbridge', 'rampart_door'],
      pos: SUNKEN_BASTION_ANCHORS.bastion,
    },
    {
      bosses: ['knight_commander_olen', 'gaoler_ossick'],
      gates: ['sea_gate', 'bailey_drawbridge', 'rampart_door', 'postern_fog', 'gaol_grate'],
      pos: {
        x: SUNKEN_BASTION_ANCHORS.drowningYard.x,
        z: SUNKEN_BASTION_ANCHORS.drowningYard.z - DROWNING_YARD_SOUTH_OF_WINCH,
      },
    },
  ],
  gravewyrm_sanctum: [
    {
      bosses: ['korgath_the_bound'],
      gates: ['rime_gate', 'west_chain_stair'],
      pos: GRAVEWYRM_SANCTUM_ANCHORS.terrace,
    },
    {
      bosses: ['korgath_the_bound', 'grand_necromancer_velkhar'],
      gates: ['rime_gate', 'west_chain_stair', 'chain_bridge', 'vault_ward'],
      pos: GRAVEWYRM_SANCTUM_ANCHORS.vault,
    },
  ],
  wildheart_basin: [
    {
      bosses: ['wildheart_beastmaster', 'fanglord_jaguar'],
      gates: ['vine_bridge_west', 'beast_pits_thorns'],
      pos: WILDHEART_BASIN_ANCHORS.beastPits,
    },
    {
      bosses: ['the_gorgebloom'],
      gates: ['vine_bridge_east', 'weeping_falls_thorns'],
      pos: WILDHEART_BASIN_ANCHORS.weepingFalls,
    },
  ],
};
