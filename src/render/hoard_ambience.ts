import type { Entity } from '../sim/types';
import type { AmbientPointSource } from './audio_sink';

/** Stationary entrance sources: rescan only when the entity roster changes. */
export class HoardAmbienceSources {
  private rosterVersion = -1;
  private readonly ids: number[] = [];

  collect(
    world: { entities: ReadonlyMap<number, Entity>; entityRosterVersion: number },
    out: AmbientPointSource[],
  ): void {
    if (this.rosterVersion !== world.entityRosterVersion) {
      this.rosterVersion = world.entityRosterVersion;
      this.ids.length = 0;
      for (const e of world.entities.values()) {
        if (e.templateId === 'hoard_entrance') this.ids.push(e.id);
      }
    }
    out.length = 0;
    for (const id of this.ids) {
      const e = world.entities.get(id);
      if (e) out.push({ id: `hoard_entrance:${id}`, kind: 'hoard_entrance', ...e.pos });
    }
  }
}

export function hoardAmbientSources(entities: ReadonlyMap<number, Entity>): AmbientPointSource[] {
  const out: AmbientPointSource[] = [];
  new HoardAmbienceSources().collect({ entities, entityRosterVersion: 0 }, out);
  return out;
}
