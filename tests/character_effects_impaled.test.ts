// Impaled (Nythraxis Bone Spike): the living body drapes the death pose while
// the aura lives and stands back up when it clears. Presentation only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterImpaledActive } from '../src/render/character_effects';
import {
  addCharacterEffectAura,
  CHARACTER_EFFECT_IMPALED,
  CHARACTER_EFFECT_SOUL_REND,
  characterEffectFlags,
  hasCharacterEffect,
} from '../src/render/character_effects_core';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  type AnimOverrideFacts,
  applyEntityAnimOverrides,
} from '../src/render/characters/anim_state_entity_core';
import { NYTHRAXIS_IMPALED_AURA_ID } from '../src/sim/nythraxis_bone_spike';
import type { Entity } from '../src/sim/types';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const IMPALED = { id: NYTHRAXIS_IMPALED_AURA_ID, kind: 'stun' };

const state = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  falling: false,
  backwards: false,
  reverseBackpedal: false,
  dead: false,
  casting: false,
  spinning: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});
const facts = (over: Partial<AnimOverrideFacts> = {}): AnimOverrideFacts => ({
  aggroTargetId: null,
  riftSliding: false,
  ...over,
});
const entity = (over: { dead: boolean; auras: { id: string; kind: string }[] }): Entity =>
  over as unknown as Entity;

describe('CHARACTER_EFFECT_IMPALED', () => {
  it('is its own flag bit, set by the Impaled aura id and nothing else', () => {
    expect(CHARACTER_EFFECT_IMPALED).not.toBe(CHARACTER_EFFECT_SOUL_REND);
    expect(CHARACTER_EFFECT_IMPALED & CHARACTER_EFFECT_SOUL_REND).toBe(0);
    expect(NYTHRAXIS_IMPALED_AURA_ID).toBe('nythraxis_impaled');
    expect(hasCharacterEffect(characterEffectFlags([IMPALED]), CHARACTER_EFFECT_IMPALED)).toBe(
      true,
    );
    // Keyed on the id, not the kind: a plain stun of any other id is not a pin.
    expect(
      hasCharacterEffect(
        characterEffectFlags([{ id: 'hammer', kind: 'stun' }]),
        CHARACTER_EFFECT_IMPALED,
      ),
    ).toBe(false);
    expect(
      hasCharacterEffect(
        characterEffectFlags([{ id: 'nythraxis_soul_rend', kind: 'debuff' }]),
        CHARACTER_EFFECT_IMPALED,
      ),
    ).toBe(false);
    // Composes with the other effects without disturbing them.
    const both = addCharacterEffectAura(addCharacterEffectAura(0, IMPALED), {
      id: 'nythraxis_soul_rend',
      kind: 'debuff',
    });
    expect(hasCharacterEffect(both, CHARACTER_EFFECT_IMPALED)).toBe(true);
    expect(hasCharacterEffect(both, CHARACTER_EFFECT_SOUL_REND)).toBe(true);
  });

  it('reads active only on a living body wearing the aura', () => {
    expect(characterImpaledActive(entity({ dead: false, auras: [IMPALED] }))).toBe(true);
    expect(characterImpaledActive(entity({ dead: true, auras: [IMPALED] }))).toBe(false);
    expect(characterImpaledActive(entity({ dead: false, auras: [] }))).toBe(false);
  });
});

describe('applyEntityAnimOverrides: the impaled pose', () => {
  it('drapes the death pose over a living pinned body and stills it', () => {
    const st = state({ moving: true, running: true, airborne: true });
    applyEntityAnimOverrides(st, facts({ aggroTargetId: 7 }), false, CHARACTER_EFFECT_IMPALED);
    expect(st.dead).toBe(true);
    expect(st.moving).toBe(false);
    expect(st.running).toBe(false);
    expect(st.airborne).toBe(false);
    expect(st.combat).toBe(false);
  });

  it('leaves an unpinned body alone, so the aura clearing stands it back up', () => {
    const st = state({ moving: true });
    applyEntityAnimOverrides(st, facts(), false, 0);
    expect(st.dead).toBe(false);
    expect(st.moving).toBe(true);
    // The default flag word is the pre-impale contract (existing callers).
    const legacy = state({ moving: true });
    applyEntityAnimOverrides(legacy, facts(), false);
    expect(legacy.dead).toBe(false);
    expect(legacy.moving).toBe(true);
  });

  it('never un-kills a real corpse and wins over the ice slide', () => {
    const corpse = state({ dead: true });
    applyEntityAnimOverrides(corpse, facts(), true, CHARACTER_EFFECT_IMPALED);
    expect(corpse.dead).toBe(true);
    const sliding = state({ moving: true, running: true });
    applyEntityAnimOverrides(
      sliding,
      facts({ riftSliding: true }),
      false,
      CHARACTER_EFFECT_IMPALED,
    );
    expect(sliding.dead).toBe(true);
    expect(sliding.moving).toBe(false);
  });

  it('is fed the renderer per-frame flag word, and only the pose is touched', () => {
    // The renderer folds `characterEffects` once per entity per frame from the
    // aura list; the override reads that word, never the aura list again. The
    // renderer's own `visuallyDead` stays the sim's death, so nameplate, health
    // bar, targeting and the corpse/ghost logic keep the live read.
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    expect(renderer).toContain('applyEntityAnimOverrides(st, e, visuallyDead, characterEffects);');
    expect(renderer).toContain('const visuallyDead = isVisuallyDead(e) && !e.ghost;');
    expect(renderer).not.toContain('CHARACTER_EFFECT_IMPALED');
  });
});
