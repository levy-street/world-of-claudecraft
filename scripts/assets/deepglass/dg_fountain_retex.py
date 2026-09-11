# Tidehold fountain: re-skin the flat-colour stone + trim of the shipped
# props/tidehold_fountain.glb with the warden kit's mottled stone (dg_lib
# mat_stone, the same look as the Warden tower walls), baked to a 1024 set.
# Water, brass and crystal keep their own materials. Runs over the bridge.
import traceback
LOG = []
try:
    exec(open("/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py").read())
    OUT_DIR = "/Users/troy/Documents/woc/carve/tmp/asset_src/deepglass"
    reset_scene(); studio_lights()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath="/Users/troy/Documents/woc/carve/public/models/props/tidehold_fountain.glb")
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    stone = mat_stone("fountain_wardenstone", STONE, STONE_DARK, scale=1.6, bump=0.30)
    trim = mat_stone("fountain_wardentrim", srgb(0xb9b3aa), STONE_DARK, scale=2.2, bump=0.26)
    stone_objs = []
    for o in objs:
        hit = False
        for i, slot in enumerate(o.material_slots):
            n = (slot.material.name if slot.material else '')
            if n.startswith('fountain_stone'):
                o.data.materials[i] = stone; hit = True
            elif n.startswith('fountain_trim'):
                o.data.materials[i] = trim; hit = True
        if hit:
            stone_objs.append(o)
    LOG.append(f"objs={len(objs)} stone/trim objs={[o.name for o in stone_objs]}")
    for o in stone_objs:
        o.data = o.data.copy()
    uv_project(stone_objs, angle=60, island_margin=0.004)
    paths, imgs = bake_asset(stone_objs, "fountain_stone", size=1024, samples=20, ao_amount=0.5)
    mat = baked_material("fountain_stone", imgs, emissive_strength=0.0)
    apply_baked(stone_objs, mat)
    export_glb(objs, OUT_DIR + "/tidehold_fountain.glb")
    render_preview(OUT_DIR + "/fountain_new.png", (9.0, -10.0, 6.0), (0, 0, 2.2), size=(900, 800), fov=40)
    LOG.append("done")
except Exception:
    LOG.append(traceback.format_exc())
print("\n".join(LOG))
