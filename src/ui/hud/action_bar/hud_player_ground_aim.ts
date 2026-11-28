// The HUD's spell ground aim, built from the Hud's own members (moved out of
// hud.ts under the monolith ratchet, the hud_vehicle_bar.ts pattern). Hud
// members are private, so the factory takes the Hud untyped; every closure
// reads the Hud live, exactly as the inline construction did.

import type { IWorld } from '../../../world_api';
import { quickGroundTarget, resolveGroundAimAbility, selectedGroundAimPoint } from './ground_aim';
import { GroundAimController } from './ground_aim_controller';

/** The private Hud members the factory reads. */
interface PlayerGroundAimHost {
  sim: Pick<
    IWorld,
    'player' | 'known' | 'entities' | 'useItem' | 'castAbilityAt' | 'groundAimPlacementPreview'
  >;
  optionsHooks: { groundAimTargetAttackable?: (targetId: number) => boolean } | null;
  renderer: { setGroundAimReticle(aim: null): void };
}

export function createHudPlayerGroundAim(hud: object): GroundAimController {
  const h = hud as PlayerGroundAimHost;
  return new GroundAimController({
    player: () => h.sim.player,
    resolveAbility: (id) => resolveGroundAimAbility(h.sim.known, id),
    seedTargetPoint: () =>
      selectedGroundAimPoint(
        h.sim.player,
        h.sim.entities,
        h.optionsHooks?.groundAimTargetAttackable,
      ),
    fallbackPoint: () => quickGroundTarget(h.sim.player, h.sim.entities),
    castAt: (id, pt) =>
      id === 'clockwork_shock_bomb' ? h.sim.useItem(id, { aim: pt }) : h.sim.castAbilityAt(id, pt),
    clearReticle: () => h.renderer.setGroundAimReticle(null),
    projectPlacement: (id, point) => h.sim.groundAimPlacementPreview(id, point),
  });
}
