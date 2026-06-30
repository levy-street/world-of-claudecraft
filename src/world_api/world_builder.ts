// Admin/moderator in-world builder: place, move, remove, and annotate decorative
// props in the live world. Server-authoritative — every member here sends a
// command the server validates against the caller's builder permission; nothing
// is applied client-side on its own. Props persist in the `world_props` table and
// are replayed to every client on load, so a placement is visible to all players.
//
// Prop "meta" is a small open string map (dialogue / music / voice) the server
// sanitizes and caps; interacting with a prop that carries it speaks a bubble and
// plays the optional audio. This facet is deliberately tiny: the heavy lifting is
// in the server dispatch + the renderer, behind the same IWorld seam as every
// other facet.
export interface IWorldWorldBuilder {
  /** Place a prop of `propKey` at (x,z) facing `facing` (radians) at `scale`. */
  placeProp(propKey: string, x: number, z: number, facing: number, scale: number): void;
  /** Move an already-placed prop (by its persisted id) to a new pose. */
  moveProp(dbId: number, x: number, z: number, facing: number, scale: number): void;
  /** Remove a placed prop by its persisted id. */
  removeProp(dbId: number): void;
  /** Set the open meta map (dialogue/music/voice) on a placed prop. */
  setPropMeta(dbId: number, meta: Record<string, string>): void;
}
