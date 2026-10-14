// The Spell Effects option: whether the spell and ability visual effects that
// PLAYERS cast draw in the 3D world. On by default; off is a player preference
// for a calmer or cheaper screen in busy group fights.
//
// It lives here rather than as a renderer field for the nameplate_dot_scale.ts
// reason: renderer.ts sits at its monolith ceiling, and the value is only ever
// handed through to the systems that draw spell effects. main.ts pushes it on
// boot and on every change (render never reads the settings store); it is
// module state, so it survives a renderer rebuild.
//
// Who is muted: effects whose SOURCE is on the player side, a player or a
// player's pet (`kind === 'player' || ownerId !== null`, the sim's own
// player-side test). Anything a mob, boss or other creature casts keeps
// drawing, because an enemy effect is often how a mechanic reads (a bomber's
// fuse flash, the beam that shows which add is healing the boss). That keeps
// the option on the right side of the graphics-fairness rule by construction
// (docs/design/graphics-settings-fairness.md), and it is also where the
// clutter is: a raid of players casting at once.
//
// Attribution: an effect is judged by the entity that CAST it, not the one it
// lands on. While the renderer handles a sim event it opens an event scope
// (`enterSpellEvent`), and every check inside that scope answers for the
// event's source, so a detonation drawn on a mob still reads as the player's.
// An event that names no caster, or a spell cue whose ability is not a player
// class ability (an encounter mechanic such as a boss's soul catch that names
// the catching player), is unattributed and always draws. Outside an event
// (the per-frame entity sync) a check answers for the id it is handed, which
// is always the wearer or caster there; `spellEffectsMutedBy` is that
// id-only answer for per-frame holds, whatever scope is open.
//
// What a muted source still shows is what the ability painter shows for a
// refused cast (ability_vfx/painter.ts, `refusedTelegraphs` and
// `areaTelegraph`, argued in cast_vfx_readiness_core.ts): the terrain-draped
// area ring and the rig's windup clip. The hard-crowd-control band over a
// stunned, feared or rooted body is held whoever wears it. Cast bars,
// nameplates, floating combat text and every HUD read never consult this
// module, and world ambience that is not a spell (weather, water splashes,
// campfire embers, mount exhaust, landing dust, fireworks, delve shrine cues)
// keeps drawing.
//
// Three/DOM-free, so a test drives it directly.

import { ABILITIES } from '../sim/data';

/** The two fields the player-side test reads off an entity. */
export interface SpellSource {
  kind: string;
  ownerId?: number | null;
}

type SourceLookup = (id: number) => SpellSource | undefined;

/** The scope `enterSpellEvent` replaced, handed back to `leaveSpellEvent`. */
export interface SpellEventScope {
  inEvent: boolean;
  sourceId: number | undefined;
}

let enabled = true;
let lookup: SourceLookup = () => undefined;
let inEvent = false;
let eventSourceId: number | undefined;

/** Apply the stored setting. */
export function setSpellEffectsEnabled(on: boolean): void {
  enabled = on;
}

/** Whether the option is on (every source draws). */
export function spellEffectsEnabled(): boolean {
  return enabled;
}

/** Point the switch at the live world's entities. The renderer's ability
 *  presentation binds it at construction, so a rebuild rebinds it. */
export function bindSpellEffectsWorld(next: SourceLookup): void {
  lookup = next;
}

/** A player or a player's pet: the side the option mutes. */
export function isPlayerSideSource(source: SpellSource | undefined): boolean {
  return !!source && (source.kind === 'player' || (source.ownerId ?? null) !== null);
}

/** A player class ability, or a player's trinket cue. */
export function isPlayerAbilityId(id: string): boolean {
  return Object.hasOwn(ABILITIES, id) || id.startsWith('trinket_');
}

/** The id an event names as its caster, if it names one. A spell cue for an
 *  ability no player class owns is an encounter mechanic: unattributed. */
export function spellEventSourceId(ev: object): number | undefined {
  const e = ev as { type?: unknown; ability?: unknown; sourceId?: unknown; entityId?: unknown };
  if (
    (e.type === 'spellfx' || e.type === 'spellfxAt') &&
    typeof e.ability === 'string' &&
    !isPlayerAbilityId(e.ability)
  )
    return undefined;
  if (typeof e.sourceId === 'number') return e.sourceId;
  if (typeof e.entityId === 'number') return e.entityId;
  return undefined;
}

/** Open the scope of one sim event; returns the scope to restore after it. */
export function enterSpellEvent(ev: object): SpellEventScope {
  const previous = { inEvent, sourceId: eventSourceId };
  inEvent = true;
  eventSourceId = spellEventSourceId(ev);
  return previous;
}

/** Close an event scope opened by `enterSpellEvent`. */
export function leaveSpellEvent(previous: SpellEventScope): void {
  inEvent = previous.inEvent;
  eventSourceId = previous.sourceId;
}

/**
 * Whether a spell effect should be skipped. Inside an event scope the event's
 * source decides, and an unattributed event draws; outside one, `id`
 * decides. An id that resolves to nothing draws too: an unattributable effect
 * is never muted, so a gap here can only show too much, never hide a read.
 */
export function spellEffectsMuted(id?: number): boolean {
  if (enabled) return false;
  return mutedSource(inEvent ? eventSourceId : id);
}

/** The id-only answer, ignoring any open event scope: for per-frame holds
 *  that name their own caster (a body, an aura's source). */
export function spellEffectsMutedBy(id: number | undefined): boolean {
  if (enabled) return false;
  return mutedSource(id);
}

function mutedSource(id: number | undefined): boolean {
  return id !== undefined && isPlayerSideSource(lookup(id));
}
