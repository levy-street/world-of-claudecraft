"""Blender-only checks for the editable animation review, without game export."""
import json
import math
from pathlib import Path
import bpy
from motion import reset


def review_cat(report_path):
    rig = bpy.data.objects['DruidCat_Rig']
    mesh = bpy.data.objects['Druid_Cat_form']
    original = [v.co.copy() for v in mesh.data.vertices]
    mechanisms = {b.name: b.matrix_basis.copy() for b in rig.pose.bones
                  if b.name.startswith('MCH-')}

    def vertices():
        rig.update_tag()
        bpy.context.view_layer.update()
        obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return [v.co.copy() for v in obj.data.vertices]

    def neutral():
        rig.animation_data.action = None
        reset(rig)
        points = vertices()
        error = max((a-b).length for a, b in zip(points, original))
        assert error < 3e-5, f'Neutral stance bends the source mesh: {error}'
        for name, expected in mechanisms.items():
            actual = rig.pose.bones[name].matrix_basis
            assert max(abs(actual[i][j]-expected[i][j]) for i in range(4)
                       for j in range(4)) < 1e-7, f'Reset cleared mechanism: {name}'
        return error

    report = {'neutral_max_vertex_error': neutral(), 'actions': {}}
    actions = {a.name: a for a in bpy.data.actions if a.get('authored_for') == rig.name}
    assert actions['Walk']['duration_seconds'] >= .8, 'Walk cycle is too hurried'
    assert actions['Walk']['duration_seconds'] >= actions['Run']['duration_seconds']*1.4
    leg_indices = [v.index for v in mesh.data.vertices if v.co.z < .22 and v.co.y < .24]
    try:
        for action in bpy.data.actions:
            if action.get('authored_for') != rig.name:
                continue
            rig.animation_data.action = action
            frames = round(action['duration_seconds']*30)
            first = None
            low, high = math.inf, -math.inf
            leg_error = 0
            chest_heights = []
            for frame in range(1, frames+2):
                bpy.context.scene.frame_set(frame)
                points = vertices()
                leg_error = max(leg_error, max((points[i]-original[i]).length for i in leg_indices))
                chest_heights.append(rig.pose.bones['chest'].matrix.translation.z)
                assert all(math.isfinite(c) for point in points for c in point), action.name
                low = min(low, min(p.z for p in points))
                high = max(high, max(p.z for p in points))
                if first is None:
                    first = points
            closure = max((a-b).length for a, b in zip(first, points))
            if action['loop']:
                assert closure < 3e-5, f'Loop seam in {action.name}: {closure}'
            if action.name in ('Idle', 'Idle_Look', 'CombatIdle', 'ProwlIdle'):
                assert leg_error < .0001, f'{action.name} bends the resting legs: {leg_error}'
            if action.name in ('Attack_Left', 'Attack_Right', 'Bite', 'Pounce', 'Finisher'):
                assert max(chest_heights)-min(chest_heights) > .055, f'{action.name} lacks chest lift and follow-through'
            report['actions'][action.name] = {
                'frames': frames, 'loop': bool(action['loop']),
                'min_z': low, 'max_z': high, 'loop_vertex_error': closure,
                'leg_rest_error': leg_error,
                'chest_vertical_range': max(chest_heights)-min(chest_heights),
                'neutral_after_action_error': neutral(),
            }
    finally:
        rig.animation_data.action = None
        reset(rig)
        bpy.context.scene.frame_set(1)
        vertices()
    Path(report_path).write_text(json.dumps(report, indent=2))
    return report
