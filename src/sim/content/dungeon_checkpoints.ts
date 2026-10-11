// Recovery points inside defeated boss arenas, in route priority order.
// Wing arenas unlock independently; deeper linear arenas require their
// predecessors too. None crosses a gate into an uncleared section.
import { DROWNED_TEMPLE_ANCHORS } from './drowned_temple_layout';
import { GRAVEWYRM_SANCTUM_ANCHORS } from './gravewyrm_sanctum_layout';
import { HOLLOW_CRYPT_ANCHORS } from './hollow_crypt_layout';
import { SUNKEN_BASTION_ANCHORS } from './sunken_bastion_layout';
import { WILDHEART_BASIN_ANCHORS } from './wildheart_basin_layout';

export interface DungeonCheckpoint {
  readonly bosses: readonly string[];
  readonly pos: { readonly x: number; readonly z: number };
}

// The Drowning Winch and its cage pit fill the centre of the Drowning Yard, so
// its point is the open floor this far south of it.
const DROWNING_YARD_SOUTH_OF_WINCH = 12;

export const DUNGEON_CHECKPOINTS: Readonly<Record<string, readonly DungeonCheckpoint[]>> = {
  hollow_crypt: [
    { bosses: ['sexton_marrow'], pos: HOLLOW_CRYPT_ANCHORS.bellYard },
    { bosses: ['rimeweb'], pos: HOLLOW_CRYPT_ANCHORS.greatWeb },
    {
      bosses: ['sexton_marrow', 'rimeweb', 'cantor_ilvane'],
      pos: HOLLOW_CRYPT_ANCHORS.loft,
    },
    // Morthen's death begins the Knellwyrm finale, so the loft stays the
    // recovery point throughout that encounter rather than its Rite Ring.
  ],
  drowned_temple: [
    { bosses: ['choirmother_selthe'], pos: DROWNED_TEMPLE_ANCHORS.court },
    {
      bosses: ['choirmother_selthe', 'tideglass_colossus'],
      pos: DROWNED_TEMPLE_ANCHORS.prismTerrace,
    },
  ],
  sunken_bastion: [
    {
      bosses: ['knight_commander_olen'],
      pos: SUNKEN_BASTION_ANCHORS.bastion,
    },
    {
      bosses: ['knight_commander_olen', 'gaoler_ossick'],
      pos: {
        x: SUNKEN_BASTION_ANCHORS.drowningYard.x,
        z: SUNKEN_BASTION_ANCHORS.drowningYard.z - DROWNING_YARD_SOUTH_OF_WINCH,
      },
    },
  ],
  gravewyrm_sanctum: [
    { bosses: ['korgath_the_bound'], pos: GRAVEWYRM_SANCTUM_ANCHORS.terrace },
    {
      bosses: ['korgath_the_bound', 'grand_necromancer_velkhar'],
      pos: GRAVEWYRM_SANCTUM_ANCHORS.vault,
    },
  ],
  wildheart_basin: [
    {
      bosses: ['wildheart_beastmaster', 'fanglord_jaguar'],
      pos: WILDHEART_BASIN_ANCHORS.beastPits,
    },
    { bosses: ['the_gorgebloom'], pos: WILDHEART_BASIN_ANCHORS.weepingFalls },
  ],
};
