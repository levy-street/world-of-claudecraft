// The viewer spec for one model in the visual manifest: what src/guide/viewer/model.ts
// buildModel needs to load and pose it. Shared by the Guide content generator
// (build_content.mjs) and the encyclopedia still renderer
// (scripts/mediawiki/render_entity_stills.mjs) so both draw a model the same way.
//
// A WOC body is split (src/render/characters/woc_armor_core.ts): its clips ride a separate
// animation library (`animUrls`) and its default kit its class set's armor files (`armor`,
// the medium file: a complete GLB the viewer's plain loader reads), bound to the base's
// skeleton by bone name exactly as in game.
export function modelSpecFor(def, wocArmorPackUrl) {
  const spec = { url: def.url, idle: def.clips?.idle ?? null, height: def.height };
  if (def.yaw) spec.yaw = def.yaw;
  if (def.hover) spec.hover = def.hover;
  if (def.show) spec.show = def.show;
  if (def.attach) {
    // swapOnly entries are pure swap-slot bases the game never renders (an
    // offhandSlot points at them; empty hands skip the entry), so the guide
    // figures must not showcase them either: without this filter the
    // caster classes would wear the warlock's fixed spellbook. The shield
    // classes' offhand bases are deliberately unflagged and keep their
    // showcase kit (the paladin still renders axe and shield).
    const attach = def.attach.filter((a) => !a.swapOnly);
    if (attach.length > 0) {
      spec.attach = attach.map((a) => {
        const o = { url: a.url, bone: a.bone };
        if (a.position) o.position = a.position;
        if (a.rotationY) o.rotationY = a.rotationY;
        if (a.gripRef) o.gripRef = a.gripRef;
        if (a.size !== undefined && a.size !== 1) o.size = a.size;
        return o;
      });
    }
  }
  if (def.weaponFix) spec.weaponFix = def.weaponFix;
  if (def.tint !== undefined) spec.tintStrength = def.tintStrength ?? 0.4;
  if (def.wocCharacter) {
    if (def.animUrls?.length) spec.animUrls = [...def.animUrls];
    const sets = [...new Set(Object.values(def.wocCharacter.items).map((item) => item.set))];
    spec.armor = sets.map((set) => wocArmorPackUrl(def.wocCharacter.fit, set, 'medium'));
  }
  return spec;
}

/** The color the viewer lerps materials toward, or null when the model is not tinted. */
export function modelTintFor(def, entityColor) {
  if (!def || def.tint === undefined) return null;
  return def.tint === 'entity' ? entityColor : def.tint;
}
