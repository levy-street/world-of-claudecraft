import type * as THREE from 'three';

const HUNTER_MELEE = new Set(['raptor_strike', 'mongoose_bite', 'wing_clip']);
const EMPTY_HANDS = new Set([
  'tame_beast',
  'revive_pet',
  'stampede',
  'pack_rally',
  'venom_dart',
  'melting_acid',
  'pummel',
  'storm_bolt',
  'pack_command',
  'unleash_beast',
  'bloodhook',
  'frostjaw_trap',
  'frost_trap',
  'garrote',
  'body_blow',
  'knockout_blow',
  'cheap_shot',
  'gouge',
  'thieves_chorus',
]);

/** Gesture-local prop ownership. Equipment changes do not rebuild the rig;
 * every transition restores exactly the visibility this gesture borrowed. */
export class ActionProps {
  private readonly hidden = new Map<THREE.Object3D, boolean>();
  private current = '';
  constructor(
    private readonly model: THREE.Object3D,
    private readonly blade: THREE.Object3D | null,
  ) {
    if (blade) blade.visible = false;
  }
  action(name: string): void {
    this.restore();
    this.current = name;
    const id = name.startsWith('Signature_')
      ? name.slice(10).replace(/^(Hold_|Channel_)/, '')
      : name === 'Dirt_Throw'
        ? 'blind'
        : name === 'Garrote_Choke'
          ? 'garrote'
          : '';
    const melee = HUNTER_MELEE.has(id) && this.blade !== null;
    if (this.blade) this.blade.visible = melee;
    if (!melee && !EMPTY_HANDS.has(id) && id !== 'blind' && id !== 'shrapnel_charge') return;
    this.model.traverse((node) => {
      if (!node.userData.heldPropHolder || node === this.blade) return;
      if ((id === 'blind' || id === 'shrapnel_charge') && node.userData.heldSlot !== 1) return;
      this.hidden.set(node, node.visible);
      node.visible = false;
    });
  }
  refresh(): void {
    this.action(this.current);
  }
  restore(): void {
    for (const [node, visible] of this.hidden) node.visible = visible;
    this.hidden.clear();
    if (this.blade) this.blade.visible = false;
  }
}
