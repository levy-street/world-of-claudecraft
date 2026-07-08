# Pixel Art Billboard Sprite System — Implementation Plan

> **Goal:** Replace all character and mob 3D models (GLB skinned meshes) with
> Ragnarok Online-style pixel art billboard sprites while keeping terrain, props,
> foliage, VFX, weather, and all non-character geometry in 3D.

---

## 1 — Scope

### What becomes sprites (63 visual keys → ~49 sprite sheets)

| Category | Keys | Unique GLBs |
|---|---|---|
| Player classes | 10 | 8 (knight, paladin, ranger, rogue, mage, barbarian, druid, CombatMech) |
| Polymorph forms | 4 | 4 (alpaca, yetialt, wolf, chicken_cow) |
| Creatures / mobs | 19 | 17 (wolf, wild_boar, fox, stag, velociraptor, yetialt, spider, frog, goblin, orc, giant, golelingevolved, dragonevolved, ghost, tolling_bell, demon, demonalt) |
| Skeletons / undead | 7 | 6 (skeleton_minion, skeleton_rogue, skeleton_warrior, skeleton_mage, necromancer, skeleton_golem) |
| Humanoid mobs (delve) | 7 | 5 (rogue_hooded, mage, barbarian, stone_cantor, spider_egg_sac) |
| NPCs | 9 | 5 (shared with player GLBs) |

**Total unique body sprite sheets: ~37** (many keys share the same GLB).

### Weapon overlays (24 keys with `attach[]`)

| Unique weapon GLBs | Overlay sheets |
|---|---|
| 12 (sword_1handed, axe_1handed, axe_2handed, crossbow_1handed, dagger, staff, wand, spellbook_open, skeleton_axe, skeleton_blade, skeleton_shield_large_a, skeleton_staff) | 12 |

### What stays 3D
Everything else: terrain, dungeon props, foliage, trees, rocks, buildings, water,
particle VFX, weather, god-rays, nameplates, cast bars, combo pips, markers.

---

## 2 — Sprite Sheet Format

### Convention (Ragnarok Online style)

- **Resolution:** 128 px tall at1x (32-bit RGBA PNG, transparent background).
- **Per-entity sheet:** Horizontal strip. One row per animation state.
- **Frame count:** 4–6 frames per animation (idle gets 4, walk 6, attack 5, cast 5, death 4).
- **Sheet dimensions (per entity):**
  - Idle: 128 × 512 (4 frames × 128 px)
  - Walk: 128 × 768 (6 frames × 128 px)
  - Attack: 128 × 640 (5 frames × 128 px)
  - Cast: 128 × 640 (5 frames × 128 px)
  - Death: 128 × 512 (4 frames × 128 px)
  - **Total per entity: 128 × 3072 px** (single atlas, all states stacked vertically)

### Naming convention
```
public/sprites/bodies/{glb_name}.png
public/sprites/weapons/{weapon_glb_name}.png
```

### Metadata (JSON per entity, loaded alongside the atlas)
```json
{
  "height": 2.6,
  "hover": 0,
  "frameWidth": 128,
  "frameHeight": 128,
  "animations": {
    "idle":   { "row": 0, "frames": 4, "fps": 4 },
    "walk":   { "row": 1, "frames": 6, "fps": 10 },
    "attack": { "row": 2, "frames": 5, "fps": 12 },
    "cast":   { "row": 3, "frames": 5, "fps": 10 },
    "death":  { "row": 4, "frames": 4, "fps": 6 }
  },
  "weaponSlot": {
    "bone": "handslot.r",
    "offsetX": 0.35,
    "offsetY": -0.15,
    "scale": 0.6
  }
}
```

Stored at `public/sprites/bodies/{glb_name}.json` and `public/sprites/weapons/{weapon_glb_name}.json`.

---

## 3 — Architecture

### New files to create

```
src/render/sprites/
├── atlas.ts          — SpriteAtlas class: loads PNG + JSON, UV slicing, frame access
├── sprite_visual.ts  — SpriteVisual class: drop-in for CharacterVisual (same interface)
├── sprite_manifest.ts— SPRITE_DEFS record: maps every VISUALS key to sprite metadata
├── sprite_locomotion.ts — SpriteLocomotion: movement/facing/speed from sprite frames
├── weapon_overlay.ts — WeaponOverlay: second sprite layer, positioned by offset map
└── prewarm.ts        — registerSpritePreloads(): hooks into existing preload system
```

### Modified files

| File | Change |
|---|---|
| `src/render/renderer.ts` | `EntityView.visual` type widens to `CharacterVisual \| SpriteVisual`; creation/update/destroy paths branch on entity type |
| `src/render/characters/manifest.ts` | New `spriteKey` field on `VisualDef` (optional); maps to sprite def |
| `src/render/characters/assets.ts` | New `prepareSprite(key)` parallel to `prepareVisual(key)` |
| `src/render/characters/preview.ts` | `CharacterPreview` gets a `useSprite` flag |
| `src/render/characters/portrait.ts` | Portrait renderer can use idle sprite frame as fallback |
| `src/render/stealth.ts` | Ghost/stealth opacity applied to sprite material the same way |
| `src/render/nameplate_painter.ts` | No change — nameplates are CSS, already independent |
| `src/render/gfx.ts` | Sprite bucket added to `GfxBucketBands` (reuses `characters` bucket) |
| `public/sprites/` | New asset directory (bodies/ and weapons/) |

---

## 4 — Core Classes

### 4.1 `SpriteAtlas`

```typescript
class SpriteAtlas {
  texture: THREE.Texture;      // the loaded PNG atlas
  meta: SpriteMeta;            // parsed JSON metadata
  private frames: Map<string, { u: number; v: number; w: number; h: number }>;

  constructor(texture: THREE.Texture, meta: SpriteMeta);

  /** Get UV rect for a given animation + frame index */
  getFrame(anim: string, frame: number): SpriteFrameUV;

  /** Dispose texture */
  dispose(): void;
}
```

- Loads via `THREE.TextureLoader` (already used throughout the codebase).
- Registers with the existing `registerPreload()` system at import time.
- UV coordinates are computed from the horizontal-strip layout.

### 4.2 `SpriteVisual` (drop-in for `CharacterVisual`)

Must satisfy the same public interface that `renderer.ts` uses:

```typescript
class SpriteVisual {
  root: THREE.Group;           // contains the sprite mesh + weapon overlay
  height: number;              // same semantics as CharacterVisual.height
  clickProxy: THREE.Object3D;  // invisible box for raycasting (same size as clickRadius)
  mixer: null;                 // no AnimationMixer — sprite animates via UV offset

  private bodyMesh: THREE.Mesh;
  private weaponMesh: THREE.Mesh | null;
  private bodyAtlas: SpriteAtlas;
  private weaponAtlas: SpriteAtlas | null;
  private currentAnim: string;
  private currentFrame: number;
  private frameTimer: number;
  private facingAngle: number;  // billboard yaw — always faces camera

  constructor(
    bodyAtlas: SpriteAtlas,
    meta: SpriteMeta,
    weaponAtlas?: SpriteAtlas | null,
    weaponMeta?: WeaponSlotMeta | null
  );

  /** Update loop — advances frame, updates facing, called every frame */
  update(dt: number, camera: THREE.Camera, lodLevel: number): void;

  /** Switch to a different animation (idle/walk/attack/cast/death) */
  setAnimation(name: string, loop?: boolean): void;

  /** Swap weapon overlay (runtime weapon equip) */
  setWeapon(atlas: SpriteAtlas | null, meta: WeaponSlotMeta | null): void;

  /** Swap skin (class variant) */
  setSkin(skin: number, atlas: SpriteAtlas, meta: SpriteMeta): void;

  /** Apply tint for team colors, debuffs, etc. */
  setTint(color: number, strength: number): void;

  /** Ghost/stealth transparency */
  setOpacity(opacity: number): void;

  dispose(): void;
}
```

#### Key implementation details:

- **Billboard facing:** Each frame, compute the yaw angle from the camera to the entity's world position, then set `bodyMesh.quaternion` to face the camera (same as `THREE.Sprite` but with full control over the plane orientation). The mesh is a `THREE.PlaneGeometry(1, 1)` positioned at the entity's pivot.
- **Frame animation:** A simple frame counter increments at the animation's FPS. When the frame index exceeds the frame count, either loop or hold (death = hold last frame). The UV offset on the material updates accordingly.
- **No AnimationMixer:** Sprites don't need skeletal animation. The `mixer` field is `null` and the update loop is custom (frame counter + UV swap), not clip-based.
- **LOD:** On far LOD (`isFar = true`), skip frame animation (hold idle frame 0) and skip weapon overlay — just show the static billboard.
- **Shadow proxy:** A small `THREE.CircleGeometry` on the ground (same as existing far-LOD shadow proxy for 3D models) to receive projected shadows.

### 4.3 `WeaponOverlay`

Second sprite layer, composited in the same `THREE.Group`:

```typescript
class WeaponOverlay {
  mesh: THREE.Mesh;           // separate PlaneGeometry, positioned by offset
  atlas: SpriteAtlas;
  meta: WeaponSlotMeta;       // { bone, offsetX, offsetY, scale }

  constructor(atlas: SpriteAtlas, meta: WeaponSlotMeta);

  /** Match the body's current animation frame (attack frame sync) */
  syncFrame(anim: string, frame: number): void;

  /** Position relative to body pivot using meta offsets */
  updatePosition(bodyFacing: number): void;

  dispose(): void;
}
```

- **Positioning:** The weapon overlay's world position is computed from the body sprite's facing angle + the per-weapon offset from the JSON metadata. No bone attachment — the offset is baked into the sprite sheet and the JSON tells us where to place the second quad.
- **Animation sync:** During attack/cast, the weapon overlay advances its frame in lockstep with the body sprite. During idle/walk, it shows frame 0 (static hold).

---

## 5 — Integration with `renderer.ts`

### 5.1 Entity creation path

The current path (simplified):

```
createView() → createCharacterVisual() → CharacterVisual constructor → group.add(root)
```

New path:

```
createView() → if (entity should use sprite) {
  createSpriteVisual() → SpriteVisual constructor → group.add(root)
} else {
  createCharacterVisual() → CharacterVisual constructor → group.add(root)
}
```

**Decision criteria for sprite vs. 3D:**
- All players, mobs, NPCs, skeletons, forms → sprite
- Objects (doors, crates, chests, pillars, quest objects) → 3D (keep as-is)
- This maps to: `view.visual !== null` means character; check `spriteKey` on the `VisualDef`

### 5.2 Entity update path

In the main `updateEntityView()` loop (~line 4779), the current code calls:

```typescript
view.visual.update(e, dt, camera, lodLevel, isSwimming);
```

This becomes:

```typescript
if (view.visual instanceof SpriteVisual) {
  view.visual.update(dt, camera, lodLevel);
  // Sprite-specific: set animation based on entity state
  const anim = getEntityAnimation(e); // idle/walk/attack/cast/death
  view.visual.setAnimation(anim);
} else {
  view.visual.update(e, dt, camera, lodLevel, isSwimming);
}
```

### 5.3 Form swap path

`swapCharacterVisual()` (line 6176) currently:
1. Returns old visual to pool
2. Builds new CharacterVisual for the form
3. Replaces `view.visual`

For sprites, the same pattern applies but `buildSpriteVisual()` replaces `buildCharacterVisual()`. The pool returns/accepts `SpriteVisual` instances separately.

### 5.4 Destruction path

`removeView()` → `returnToVisualPool(view)` currently handles `CharacterVisual`. Must also handle `SpriteVisual` with its own pool.

---

## 6 — Locomotion

`src/render/locomotion.ts` reads bone positions (`hips`, `toes.l`, `toes.r`) to compute
foot planting, lean, speed, etc. Sprites don't have bones.

**Replacement:** `src/render/sprites/sprite_locomotion.ts`

```typescript
function spriteLocomotion(
  e: Entity,
  view: EntityView,
  dt: number
): { leanX: number; leanZ: number; speed: number } {
  // Read from entity state directly:
  // - e.pos.x/z for position delta → speed
  // - e.rot for facing angle → lean
  // No bone data needed — derive lean from velocity direction changes
  const dx = e.pos.x - view.lastX;
  const dz = e.pos.z - view.lastZ;
  const speed = Math.sqrt(dx * dx + dz * dz) / dt;
  // Lean based on acceleration
  return { leanX: 0, leanZ: 0, speed };
}
```

The locomotion result feeds into the sprite's body mesh position/scale tweaks (slight tilt during turns) and walk/run animation speed selection.

---

## 7 — Animation State Machine

Maps entity state to sprite animation:

| Entity state | Sprite animation | Loop? |
|---|---|---|
| idle, casting CDs | `idle` | yes |
| moving (walk/run) | `walk` | yes |
| attacking | `attack` | no (hold last frame) |
| casting spell | `cast` | no (hold last frame) |
| dead | `death` | no (hold last frame) |
| sitting | `idle` | yes (reuse) |
| swimming | `walk` | yes (reuse) |

The mapper lives in `src/render/sprites/sprite_visual.ts` as `getEntityAnimation(e: Entity): string`.

---

## 8 — Quality Tier Integration

Sprites respect the existing `GFX` tier system:

| Tier | Sprite behavior |
|---|---|
| **low** | `MeshBasicMaterial` (unlit), no weapon overlay, frame animation disabled (hold idle), no tint |
| **medium** | `MeshBasicMaterial`, weapon overlay enabled, frame animation at 50% FPS, tint supported |
| **high** | `MeshLambertMaterial` (subtle lighting), full FPS, weapon overlay, tint + rim glow option |
| **ultra** | `MeshStandardMaterial` (if PBR available), full FPS, weapon overlay, tint + rim glow |

The `characters` budget bucket already governs character rendering; sprites consume from the same bucket.

---

## 9 — Preload & Boot

In `src/render/sprites/prewarm.ts`:

```typescript
import { registerPreload } from '../assets/preload';

// Called at import time — kicks off fetch for all sprite sheets
export function registerSpritePreloads(): void {
  for (const [key, def] of Object.entries(SPRITE_DEFS)) {
    const bodyUrl = `sprites/bodies/${def.bodyPng}`;
    const metaUrl = `sprites/bodies/${def.bodyJson}`;
    registerPreload(loadTexture(bodyUrl));
    registerPreload(fetch(metaUrl).then(r => r.json()));
    if (def.weaponPng) {
      registerPreload(loadTexture(`sprites/weapons/${def.weaponPng}`));
      registerPreload(fetch(`sprites/weapons/${def.weaponJson}`).then(r => r.json()));
    }
  }
}
```

This module is imported by `src/render/renderer.ts` (or one of its imports) so the fetches
start at page load. After `assetsReady()` resolves, all sprite data is in memory
and the `SpriteAtlas` cache is populated.

---

## 10 — Asset Generation Pipeline

### Phase 1: Manual pixel art creation
- Create base sprite sheets for each unique GLB (37 bodies + 12 weapons).
- Tools: Aseprite, Piskel, or any pixel art editor.
- Export as 32-bit RGBA PNG at 128 px tall.
- Write JSON metadata by hand (or with a small build script).

### Phase 2: Build-time compositing (optional future enhancement)
- A `scripts/sprite-compose.ts` script could use `sharp` (already a devDependency)
  to automatically compose weapon overlays onto body sprites at build time for the
  pre-composited fallback path. Not required for the initial implementation.

### Directory structure:
```
public/sprites/
├── bodies/
│   ├── knight.png          + knight.json
│   ├── paladin.png         + paladin.json
│   ├── ranger.png          + ranger.json
│   ├── rogue.png           + rogue.json
│   ├── mage.png            + mage.json
│   ├── barbarian.png       + barbarian.json
│   ├── druid.png           + druid.json
│   ├── CombatMech.png      + CombatMech.json
│   ├── wolf.png            + wolf.json
│   ├── wild_boar.png       + wild_boar.json
│   ├── fox.png             + fox.json
│   ├── stag.png            + stag.json
│   ├── ... (37 total)
│   └── skeleton_golem.png  + skeleton_golem.json
└── weapons/
    ├── sword_1handed.png   + sword_1handed.json
    ├── axe_1handed.png     + axe_1handed.json
    ├── staff.png           + staff.json
    ├── dagger.png          + dagger.json
    ├── ... (12 total)
    └── skeleton_staff.png  + skeleton_staff.json
```

---

## 11 — Implementation Phases

### Phase A — Core sprite infrastructure (est. ~3 files, ~800 lines)
1. `src/render/sprites/atlas.ts` — SpriteAtlas class
2. `src/render/sprites/sprite_visual.ts` — SpriteVisual class
3. `src/render/sprites/sprite_manifest.ts` — SPRITE_DEFS record mapping

**Exit criteria:** SpriteVisual can load a test sprite sheet, billboard toward camera,
animate through idle/walk/attack/cast/death, and be disposed cleanly. Unit tests pass.

### Phase B — Renderer integration (est. ~5 files modified, ~400 lines)
1. Widen `EntityView.visual` type in `renderer.ts`
2. Add sprite creation/update/destruction paths
3. Add sprite-specific pooling (`takePooledSpriteVisual` / `returnToSpriteVisualPool`)
4. Integrate sprite path in `updateEntityView()` loop
5. Integrate form swap path

**Exit criteria:** Entities render as sprites in-game. Walking, attacking, dying
all animate correctly. Form swaps (sheep/bear/cat/travel) work.

### Phase C — Weapon overlays (est. ~2 files, ~200 lines)
1. `src/render/sprites/weapon_overlay.ts` — WeaponOverlay class
2. Integrate into SpriteVisual (second mesh in group)
3. Runtime weapon equip swap via `setWeapon()`

**Exit criteria:** Players see their equipped weapon overlaid on the body sprite.
Weapon swaps (loot, equip) update the overlay in real-time.

### Phase D — Locomotion & polish (est. ~2 files, ~200 lines)
1. `src/render/sprites/sprite_locomotion.ts` — sprite locomotion (no bones)
2. Integrate lean/speed from sprite locomotion into renderer
3. Portrait renderer uses idle sprite frame as option
4. Character preview supports sprite mode

**Exit criteria:** Foot planting, lean, speed display all work without bone data.
Portraits and preview windows show sprites.

### Phase E — Quality tier & performance (est. ~1 file, ~100 lines)
1. Tier-based material selection in SpriteVisual
2. LOD behavior (far = static billboard, near = animated)
3. Budget bucket integration

**Exit criteria:** Sprites render correctly across all 4 GFX tiers. No performance
regression vs. 3D models (sprites should be faster).

### Phase F — Placeholder sprite sheets (est. art asset work)
1. Create placeholder pixel art for all 49 sheets (can be simple colored shapes
   initially to validate the pipeline)
2. Fill in JSON metadata
3. Verify every visual key maps correctly

**Exit criteria:** All 63 visual keys have corresponding sprite sheets. No missing
textures or fallback-to-3D needed.

---

## 12 — Testing Strategy

### Unit tests
- `SpriteAtlas`: frame UV calculation, metadata parsing, edge cases
- `SpriteVisual`: animation state machine, frame advancement, billboard facing
- `WeaponOverlay`: positioning math, frame sync
- `sprite_manifest`: every VISUALS key has a corresponding SPRITE_DEFS entry

### Integration tests
- Renderer creates `SpriteVisual` for character entities (not objects)
- Renderer pools and recycles `SpriteVisual` instances correctly
- Form swap creates correct sprite for each polymorph form
- Weapon equip updates the overlay

### Visual QA
- Manual in-browser: verify billboard always faces camera while orbiting
- Walk cycle speed matches entity velocity
- Attack animation triggers on hit, holds last frame
- Death animation plays once, holds last frame
- Weapon overlay positions correctly relative to body
- Low tier: no weapon overlay, no animation, unlit material
- Ultra tier: full feature set, lit material

---

## 13 — Risk & Mitigations

| Risk | Mitigation |
|---|---|
| Billboard fighting with terrain (z-fighting on ground plane) | Use `THREE.Sprite`-style facing or offset Y slightly above pivot |
| Weapon overlay misalignment across animations | Per-animation offset keys in JSON metadata (attack pose differs from idle) |
| Performance regression from many sprite draw calls | Use `THREE.InstancedMesh` batch for identical sprites; sprites already cheaper than skinned meshes |
| Missing sprite fallback | If sprite not found, fall back to existing 3D model (graceful degradation) |
| Skin swaps (class variants) need different sprites | Each skin gets its own sprite sheet; `setSkin()` swaps the atlas |

---

## 14 — Open Questions (for future discussion)

1. **Sprite artist sourcing:** Will we commission pixel art, use AI generation, or hand-draw?
2. **Animation frame count:** 4–6 frames is the plan, but some states (death) could use more for polish.
3. **Night/day cycle:** Should sprites have a separate night palette (darker tint) or rely on the existing lighting system?
4. **Emotes:** The existing emote system (`overheadEmote`) uses3D animated clips. Should sprite emotes be separate sprite frames (more art) or keep the existing3D emote balloons?
5. **Mount system:** If mounts are added later, they'd also need sprites or a3D+sprite hybrid.

---

*Plan generated from codebase analysis of `src/render/`, `src/sim/`, and project
infrastructure. All file paths and type definitions verified against the actual source.*
