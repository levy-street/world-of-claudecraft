import type { Sim } from '../sim/sim';
import type { EquipSlot, PlayerClass } from '../sim/types';

/** Scenario equipment uses the normal equip rules, so the preview's real
 * animation and held meshes match the selected fighting discipline. */
export function equipStudioLoadout(sim: Sim, cls: PlayerClass, spec: string | null): void {
  const wear = (id: string, slot: EquipSlot) => {
    sim.addItem(id, 1, sim.player.id, { silent: true });
    sim.equipItem(id, sim.player.id, slot);
  };
  if (cls === 'warrior') {
    sim.unequipItem('offhand');
    if (spec === 'arms') wear('wyrmfang_greatblade', 'mainhand');
    else if (spec === 'fury') {
      wear('wyrmfang_greatblade', 'mainhand');
      wear('deathless_greatblade', 'offhand');
    } else {
      wear('worn_sword', 'mainhand');
      wear('eastbrook_buckler', 'offhand');
    }
  } else if (cls === 'rogue') {
    wear(spec === 'combat' ? 'worn_sword' : 'rusty_dagger', 'mainhand');
    wear('rusty_dagger', 'offhand');
  }
}
