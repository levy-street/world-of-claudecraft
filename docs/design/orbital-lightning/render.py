"""Render stills or all frames from the saved scene, without changing the file."""
from pathlib import Path
import sys
import bpy

HERE = Path(__file__).resolve().parent
scene = bpy.context.scene
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
animation = 'animation' in args
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for device in prefs.devices:
    device.use = device.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = 12 if animation else 32
scene.render.use_persistent_data = True
scene.render.resolution_percentage = 60 if animation else 100
dest = HERE / ('frames' if animation else 'stills')
dest.mkdir(exist_ok=True)
shot_frames = [m.frame for m in scene.timeline_markers if m.name.startswith('FIRE_')]
frames = range(scene.frame_start, scene.frame_end + 1) if animation else [
    10, round((scene.timeline_markers['CHARGE'].frame + shot_frames[0]) / 2),
    *shot_frames, min(scene.frame_end, shot_frames[-1] + 10), scene.frame_end]
for frame in frames:
    scene.frame_set(frame)
    scene.render.filepath = str(dest / f'{frame:04}.png')
    bpy.ops.render.render(write_still=True)
print('ORBITAL_LIGHTNING_RENDER_OK')
