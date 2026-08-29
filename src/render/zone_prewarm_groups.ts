// Zone/archetype prewarm-group builders: the hidden grids of mob, NPC, player
// and quest-object rigs the prewarm manifest entries compile so a first live
// sighting never links programs inside a gameplay frame. The builders take the
// renderer as an untyped host and cast to ZonePrewarmGroupHost because the
// members they touch are private on Renderer, and a monolith under a line
// ratchet should not carry a public surface that exists only for this seam
// (the interior_encounter_prewarm_pass.ts pattern).
import * as THREE from 'three';
import { CLASSES, MOBS, NPCS } from '../sim/data';
import { ALL_CLASSES, type Entity, type ZoneDef } from '../sim/types';
import { type CharacterVisual, createCharacterVisual } from './characters';
import { skinCount, visualKeyFor } from './characters/manifest';
import { characterVisualPoolKey } from './characters/visual_pool';
import type { PooledObjectView } from './ground_object_pool';
import { buildGroundQuestObject } from './quest_objects';
import { setRenderCategory } from './renderer_diagnostics';

const PREWARM_MOB_TEMPLATE_IDS = [
  'forest_wolf',
  'wild_boar',
  'webwood_spider',
  'mudfin_murloc',
  'tunnel_rat',
  'vale_bandit',
  'restless_bones',
  'old_greyjaw',
  'mogger',
  'mire_widow',
  'fen_troll',
  'gravecaller_cultist',
  'stormcrag_elemental',
  'thornpeak_ogre',
  'glimmermere_wader',
  'sethrael_palecoil',
  'warlock_imp',
  'warlock_voidwalker',
] as const;
export const PREWARM_OBJECT_ITEM_IDS = [
  'supply_crate',
  'lost_caravan_goods',
  'morthen_grimoire',
  'gravecaller_sigil',
  'weathered_ledger_page',
  'fen_muster_order',
  'rusted_censer',
  'bastion_ward_stone',
  'ogre_war_totem',
  'sanctum_key_shard',
  'gravewyrm_sigil',
  'crypt_ritual_circle',
] as const;
export const PREWARM_MOB_POOL_COPIES = 3;
export const PREWARM_OBJECT_POOL_COPIES = 2;
// The common templates above are pooled several-deep (they spawn in groups); every
// OTHER mob model is still built once so its shader program compiles at load.
const PREWARM_MOB_COMMON_IDS = new Set<string>(PREWARM_MOB_TEMPLATE_IDS);

export function prewarmPlayerSkinVariantCount(): number {
  return ALL_CLASSES.reduce((sum, cls) => sum + skinCount(`player_${cls}`), 0);
}

/** The Renderer members the builders touch. Renderer satisfies this shape with
 *  private members, so call sites pass `this` as a bare object and each builder
 *  casts internally. */
export interface ZonePrewarmGroupHost {
  sim: { player: { pos: { x: number; y: number; z: number } } };
  prewarmEntity(
    kind: 'player' | 'mob' | 'npc',
    templateId: string,
    color: number,
    scale: number,
    skin?: number,
    id?: number,
  ): Entity;
  storePooledObject(key: string, object: PooledObjectView): void;
  templateIdsInZone(zone: ZoneDef, kind: 'mob' | 'npc'): string[];
  prewarmedMobTemplates: Set<string>;
  prewarmedNpcModels: Set<string>;
}

export function buildEntityPrewarmGroup(
  host: object,
  zone: ZoneDef,
): {
  group: THREE.Group;
  pooled: { key: string; visual: CharacterVisual }[];
} {
  const h = host as ZonePrewarmGroupHost;
  const group = new THREE.Group();
  const pooled: { key: string; visual: CharacterVisual }[] = [];
  const p = h.sim.player;
  group.position.set(p.pos.x, p.pos.y, p.pos.z - 14);
  setRenderCategory(group, 'prewarm');
  let idx = 0;
  const place = (obj: THREE.Object3D): void => {
    obj.position.set(((idx % 6) - 2.5) * 3.2, 0, Math.floor(idx / 6) * 3.2);
    group.add(obj);
    idx++;
  };
  const build = (templateId: string, copies: number): void => {
    const template = MOBS[templateId];
    if (!template) return;
    for (let i = 0; i < copies; i++) {
      const entity = h.prewarmEntity('mob', template.id, template.color, template.scale);
      const visual = createCharacterVisual(entity);
      // Assets unavailable: skip the seed so a later zone preparation can retry it.
      if (!visual) continue;
      const poolKey = characterVisualPoolKey(entity);
      if (poolKey) pooled.push({ key: poolKey, visual });
      visual.root.visible = true;
      place(visual.root);
    }
  };
  // Warm only templates that can appear in this zone. The per-template set
  // persists across transitions, so shared families are paid once per session.
  for (const templateId of h.templateIdsInZone(zone, 'mob')) {
    if (h.prewarmedMobTemplates.has(templateId)) continue;
    const copies = PREWARM_MOB_COMMON_IDS.has(templateId) ? PREWARM_MOB_POOL_COPIES : 1;
    build(templateId, copies);
    h.prewarmedMobTemplates.add(templateId);
  }
  return { group, pooled };
}

// Every NPC visual MODEL once (NPCs were not prewarmed at all, entering a zone hub
// compiled their shaders live). Most NPCs share a handful of models (npc_knight,
// npc_mage, ...), so dedup by model key (visualKeyFor) builds each only once.
export function buildNpcPrewarmGroup(
  host: object,
  zone: ZoneDef,
  deadline: number,
): {
  group: THREE.Group;
  pooled: { key: string; visual: CharacterVisual }[];
  /** Ids whose model ended the loop warm: freshly built here, already warm
   *  from an earlier id or session pass, or with no static record to build.
   *  An asset-unavailable skip stays uncounted so warmed < planned reports
   *  the unwarmed remainder instead of masquerading as complete work. */
  warmed: number;
  planned: number;
  trimmed: boolean;
} {
  const h = host as ZonePrewarmGroupHost;
  const group = new THREE.Group();
  const pooled: { key: string; visual: CharacterVisual }[] = [];
  const p = h.sim.player;
  group.position.set(p.pos.x, p.pos.y, p.pos.z - 24);
  setRenderCategory(group, 'prewarm');
  let idx = 0;
  const npcIds = h.templateIdsInZone(zone, 'npc');
  let warmed = 0;
  let trimmed = false;
  for (const npcId of npcIds) {
    if (performance.now() >= deadline) {
      trimmed = true;
      break;
    }
    const npc = NPCS[npcId];
    // Dynamic-entity template with no static NPC record: nothing to build.
    if (!npc) {
      warmed++;
      continue;
    }
    const entity = h.prewarmEntity('npc', npc.id, npc.color, 1);
    const modelKey = visualKeyFor(entity);
    // Shared model already warm: this id's planned work exists already.
    if (h.prewarmedNpcModels.has(modelKey)) {
      warmed++;
      continue;
    }
    const visual = createCharacterVisual(entity);
    // assets unavailable: skip the seed, leave the model unmarked and the
    // id uncounted, so a later zone preparation can retry it
    if (!visual) continue;
    h.prewarmedNpcModels.add(modelKey);
    warmed++;
    const poolKey = characterVisualPoolKey(entity);
    if (poolKey) pooled.push({ key: poolKey, visual });
    visual.root.visible = true;
    visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
    group.add(visual.root);
    idx++;
  }
  return { group, pooled, warmed, planned: npcIds.length, trimmed };
}

export function buildPlayerPrewarmGroup(
  host: object,
  deadline: number,
): {
  group: THREE.Group;
  visualCount: number;
  visuals: CharacterVisual[];
  plannedVisuals: number;
  trimmed: boolean;
} {
  const h = host as ZonePrewarmGroupHost;
  const group = new THREE.Group();
  const p = h.sim.player;
  group.position.set(p.pos.x, p.pos.y, p.pos.z - 21);
  setRenderCategory(group, 'prewarm');
  // Skin variants plus one aura-glow rig per class (the second loop below).
  const plannedVisuals = prewarmPlayerSkinVariantCount() + ALL_CLASSES.length;
  let idx = 0;
  const visuals: CharacterVisual[] = [];
  const place = (obj: THREE.Object3D): void => {
    obj.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
    group.add(obj);
    idx++;
  };
  // Build Metamorphosis before regular player variants so first activation
  // cannot pay prepareVisual's clone, traversal and far-LOD bake cost in
  // combat. The form also joins the existing shader compile pass.
  const metamorphEntity = h.prewarmEntity(
    'player',
    'warlock',
    CLASSES.warlock?.color ?? 0xffffff,
    1,
    0,
    -10_999,
  );
  const metamorph = createCharacterVisual(metamorphEntity, 'form_metamorph');
  if (metamorph) {
    metamorph.setActive(true);
    place(metamorph.root);
    visuals.push(metamorph);
  }
  for (const cls of ALL_CLASSES) {
    const variants = skinCount(`player_${cls}`);
    for (let skin = 0; skin < variants; skin++) {
      if (performance.now() >= deadline) {
        return { group, visualCount: idx, visuals, plannedVisuals, trimmed: true };
      }
      const color = CLASSES[cls]?.color ?? 0xffffff;
      const entity = h.prewarmEntity('player', cls, color, 1, skin, -11_000 - idx);
      const visual = createCharacterVisual(entity);
      // assets unavailable: skip the seed
      if (!visual) continue;
      visual.root.visible = true;
      place(visual.root);
      visuals.push(visual);
    }
  }
  // One EXTRA rig per class wearing the ability-VFX aura glow: setAuraGlow's
  // on-edge swaps the rig materials for private clones, and the FIRST spec'd
  // cast of a session used to compile them synchronously mid-frame (the
  // measured 'mage' program link landing inside the player's own cast
  // moment, e.g. mid Solemn Prayer cast bar). The clones now keep the
  // source's shader hooks and therefore its program cache key
  // (material_clone_hooks.ts), which is what closes that hole for mob rigs
  // and non-default skins too; this seed stays as the boot-side belt for the
  // player classes, and for any rig material with no hook to preserve. The
  // group is removed in the prewarm finally, but linked programs stay cached
  // for the session.
  for (const cls of ALL_CLASSES) {
    if (performance.now() >= deadline) {
      return { group, visualCount: idx, visuals, plannedVisuals, trimmed: true };
    }
    const color = CLASSES[cls]?.color ?? 0xffffff;
    const entity = h.prewarmEntity('player', cls, color, 1, 0, -11_500 - idx);
    const visual = createCharacterVisual(entity);
    if (!visual) continue;
    visual.root.visible = true;
    visual.setAuraGlow(0xffffff, 0.02);
    place(visual.root);
    visuals.push(visual);
  }
  return { group, visualCount: idx, visuals, plannedVisuals, trimmed: false };
}

export function buildObjectPrewarmGroup(host: object): THREE.Group {
  const h = host as ZonePrewarmGroupHost;
  const group = new THREE.Group();
  const p = h.sim.player;
  group.position.set(p.pos.x, p.pos.y, p.pos.z - 17);
  setRenderCategory(group, 'prewarm');
  let idx = 0;
  const place = (obj: THREE.Object3D): void => {
    obj.position.set(((idx % 6) - 2.5) * 3.2, 0, Math.floor(idx / 6) * 3.2);
    group.add(obj);
    idx++;
  };
  for (const itemId of PREWARM_OBJECT_ITEM_IDS) {
    const key = `object:${itemId}`;
    for (let i = 0; i < PREWARM_OBJECT_POOL_COPIES; i++) {
      const built = buildGroundQuestObject(itemId, -20_000 - idx);
      h.storePooledObject(key, built);
      built.group.visible = true;
      // Hide the object's own point light (e.g. the ritual circle glow) during
      // the prewarm: it must not inflate numPointLights, or every material would
      // compile for one more light than the open world's constant budget ever
      // shows and they would all recompile on first travel. Restored in the
      // prewarm finally so the pooled object lights normally when reused live.
      built.group.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) o.visible = false;
      });
      place(built.group);
    }
  }
  return group;
}
