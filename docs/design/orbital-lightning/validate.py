"""Validate the saved Blender scene at every frame, independent of construction."""
import json
from pathlib import Path
import bpy

scene = bpy.context.scene
asset = bpy.data.collections['ASSET_OrbitalLightning']
root = bpy.data.objects['OrbitalLightning_ROOT']
boss = bpy.data.objects['PREVIEW_StationaryBoss']
count = root['orb_count']
assert len([o for o in asset.all_objects if o.name.startswith('Orb_') and len(o.name) == 6]) == count
assert boss.animation_data is None
baseline = boss.matrix_world.copy()
firings = {i: [] for i in range(1, count + 1)}
visible_at_end = []


def visible(obj):
    if obj.hide_render or obj.type not in ('MESH', 'CURVE'):
        return False
    cursor = obj
    while cursor:
        if max(abs(s) for s in cursor.scale) < 0.0001:
            return False
        cursor = cursor.parent
    return True


max_visible = 0
for frame in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(frame)
    assert boss.matrix_world == baseline, f'Boss moved at {frame}'
    active = []
    for i in firings:
        beam = bpy.data.objects[f'Shot_{i:02}_BeamCore']
        if visible(beam):
            firings[i].append(frame)
            active.append(i)
            orb = bpy.data.objects[f'Orb_{i:02}']
            start = beam.matrix_world @ beam.data.splines[0].points[0].co.to_3d()
            assert (start - orb.matrix_world.translation).length < .025, f'Detached beam {i} at {frame}'
    assert len(active) <= 1, f'Simultaneous shots at frame {frame}'
    max_visible = max(max_visible, sum(visible(obj) for obj in asset.all_objects))
    if frame == scene.frame_end:
        visible_at_end = [o.name for o in asset.all_objects if visible(o)]
assert not visible_at_end, f'Effect did not clear: {visible_at_end}'
assert all(firings.values()), 'Missing shot'
starts = [frames[0] for frames in firings.values()]
assert starts == sorted(set(starts))
assert starts == [scene.timeline_markers[f'FIRE_{i:02}'].frame for i in firings]
assert all(abs((b - a) / scene.render.fps - root['shot_delay']) <= 1 / scene.render.fps for a, b in zip(starts, starts[1:]))
scene.frame_set(round(1.8 * scene.render.fps) + 1)
for i in range(1, count + 1):
    orb = bpy.data.objects[f'Orb_{i:02}']
    assert abs(orb.matrix_world.translation.xy.length - root['orbit_radius']) < .001
    assert visible(bpy.data.objects[f'Orb_{i:02}_Core'])
depsgraph = bpy.context.evaluated_depsgraph_get()
triangles = 0
for obj in asset.all_objects:
    if obj.type in ('CURVE', 'MESH'):
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        if mesh:
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
report = {'result': 'PASS', 'blender': bpy.app.version_string, 'frames_checked': scene.frame_end,
          'stationary_boss': True, 'nonoverlapping_shots': firings,
          'beam_origins_attached': True, 'clean_end': True,
          'asset_objects': len(asset.all_objects), 'peak_visible_objects': max_visible,
          'evaluated_triangles_at_charge_sample': triangles,
          'notes': 'Authored geometry count is not engine draw calls or a runtime performance measurement.'}
dest = Path(__file__).resolve().parent / 'validation.json'
dest.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
