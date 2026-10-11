"""Run with Blender --background --factory-startup --python build.py.

Creates only an offline VFX art study, never game content or combat logic.
"""
import json
import math
from pathlib import Path
import random
import sys
import bpy
from mathutils import Vector, Euler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from config import CFG as c
from primitives import (collection, empty, ico, curves, ring, bolt, key,
                        scale_keys, visibility, material, emission_keys, linear_animation)


def build_orbs(coll, root, blue, white, violet):
    orbit = empty('Orbs', coll, root)
    key(orbit, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (0, 0, c.orbit_speed * c.finish))], c)
    orb_roots = []
    for i in range(c.orb_count):
        angle = c.angle(i, 0)
        summon_scale = c.summon_duration / .65
        birth = (0.10 + i * 0.045) * summon_scale
        fire = c.shot(i)
        orb = empty(f'Orb_{i + 1:02}', coll, orbit,
                    (c.orbit_radius * math.cos(angle), c.orbit_radius * math.sin(angle), c.orbit_height))
        orb_roots.append(orb)
        size = c.orb_size
        scale_keys(orb, [(0, 0), (birth, 0), (birth + .12 * summon_scale, 1.18), (birth + .26 * summon_scale, 1),
                         (fire - c.prefire_duration, 1), (fire - .04, 1.20), (fire + .04, .80),
                         (fire + .20, .90), (c.shot(c.orb_count - 1) + .25, .65),
                         (c.shot(c.orb_count - 1) + .65, 0)], c)
        coremat = material(f'Orb_{i + 1:02}_CoreEmission', (.50, .86, 1), c.orb_brightness)
        emission_keys(coremat, [(0, 0), (birth + .12 * summon_scale, 3), (c.first_shot - .35, c.orb_brightness),
                                (fire - .08, c.orb_brightness * 2), (fire + .08, 2)], c)
        core = ico(f'Orb_{i + 1:02}_Core', coll, orb, (0, 0, 0), (size * .38,) * 3, coremat)
        # Open twisted meridians leave negative space around a condensed core.
        shellpaths = []
        arcpaths = []
        for band in range(3):
            rot = Euler((.45 + band * .85, band * .73, band * 1.7)).to_matrix()
            shellpaths.append([tuple(rot @ Vector(p)) for p in ring(size, sweep=5.15, points=44)])
            rng = random.Random(c.seed + i * 40 + band)
            arcpaths.append([tuple(rot @ Vector((size * 1.23 * math.cos(t),
                             size * 1.23 * math.sin(t), rng.uniform(-.07, .07))))
                             for t in [k * 4.6 / 30 for k in range(31)]])
        shell = curves(f'Orb_{i + 1:02}_OuterEnergy', shellpaths, .024, blue, coll, orb)
        arcmat = material(f'Orb_{i + 1:02}_ArcPulse', (.035, .26, 1), 2)
        arcs = curves(f'Orb_{i + 1:02}_LocalArcs', arcpaths, .010, arcmat, coll, orb)
        pulses = [(birth, .4)]
        t = birth + .12
        while t < fire - .12:
            progress = min(1, (t - birth) / c.charge_duration)
            pulses.extend([(t, 1.1 + progress * 2.8), (t + .042, .7 + progress)])
            t += .26 - progress * .15
        pulses.extend([(fire - .08, 6), (fire + .08, .65),
                       (c.shot(c.orb_count - 1) + .6, 0)])
        emission_keys(arcmat, pulses, c)
        key(shell, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (1.4, -2, 5))], c)
        key(arcs, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (-2, 3, -7))], c)
        sparks = []
        rng = random.Random(c.seed + i)
        for j in range(9):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(size * 1.35, size * 1.9)
            z = rng.uniform(-size, size)
            sparks.append([(r * math.cos(a), r * math.sin(a), z),
                           ((r + .10) * math.cos(a), (r + .10) * math.sin(a), z + .06)])
        sp = curves(f'Orb_{i + 1:02}_Sparks', sparks, .011, blue, coll, orb)
        key(sp, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (0, 1, -4))], c)
        halo = curves(f'Orb_{i + 1:02}_PrefireHalo', [ring(size * 1.65)], .023, white, coll, orb)
        visibility(halo, fire - c.prefire_duration, fire + .04, c)
        scale_keys(halo, [(fire - c.prefire_duration, 1.35), (fire, .72)], c)
    return orb_roots


def build_charge(coll, root, blue, violet):
    charge = empty('ChargeEffects', coll, root)
    for k in range(2):
        paths = [ring(c.orbit_radius + .10 * k, .08 + k * .02,
                      j * math.tau / 6, .67, 18) for j in range(6)]
        obj = curves(f'ChargeRing_{k}', paths, .012, violet, coll, charge)
        scale_keys(obj, [(0, 0), (c.summon_duration * .40 / .65, .8), (c.summon_duration, 1), (c.first_shot, 1),
                         (c.shot(c.orb_count - 1) + .35, 0)], c)
        key(obj, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (0, 0, (-1)**k * 1.5))], c)
    links = []
    for i in range(c.orb_count):
        a = c.angle(i, 0)
        end = (c.orbit_radius * math.cos(a), c.orbit_radius * math.sin(a), c.orbit_height)
        links.append(bolt((0, 0, 1.8), end, c.seed + i, jitter=.12))
    summon = curves('SharedStormEnergy_SummonTethers', links, .018, blue, coll, charge)
    visibility(summon, c.summon_duration * .16 / .65, c.summon_duration * .56 / .65, c)
    key(summon, 'rotation_euler', [(0, (0, 0, 0)), (c.finish, (0, 0, c.orbit_speed * c.finish))], c)


def build_shots(coll, impacts_coll, root, blue, white, violet):
    shots = empty('Shots', coll, root)
    impacts = empty('Impacts', impacts_coll, root)
    for i in range(c.orb_count):
        fire = c.shot(i)
        a = c.angle(i, fire)
        origin = (c.orbit_radius * math.cos(a), c.orbit_radius * math.sin(a), c.orbit_height)
        radius = c.orbit_radius + c.lightning_shot_length
        target = (radius * math.cos(a), radius * math.sin(a), .055)
        shot = empty(f'Shot_{i + 1:02}', coll, shots)
        path = bolt(origin, target, c.seed + i * 73, jitter=.22)
        beam = curves(f'Shot_{i + 1:02}_BeamCore', [path], c.lightning_thickness, white, coll, shot)
        trail = curves(f'Shot_{i + 1:02}_BeamTrail', [path], c.lightning_thickness * 2.1, blue, coll, shot)
        branchpaths = []
        rng = random.Random(c.seed + i * 101)
        for j in range(c.branch_count):
            p = Vector(path[3 + j % 9])
            end = p + Vector((rng.uniform(-.6, .6), rng.uniform(-.6, .6), rng.uniform(-1, -.3)))
            branchpaths.append(bolt(p, end, c.seed + i * 20 + j, steps=6, jitter=.10))
        branches = curves(f'Shot_{i + 1:02}_BeamBranches', branchpaths, .012, blue, coll, shot)
        for obj in (beam, trail, branches):
            visibility(obj, fire, fire + c.shot_duration, c)
        # Core and trail follow the moving orb for the short discharge lifetime.
        for obj in (beam, trail):
            for offset in (0, 1 / c.fps, 2 / c.fps, c.shot_duration):
                now = a + c.orbit_speed * offset
                delta = Vector((c.orbit_radius * math.cos(now), c.orbit_radius * math.sin(now), c.orbit_height)) - Vector(origin)
                for idx, point in enumerate(obj.data.splines[0].points):
                    v = Vector(path[idx]) + delta * (1 - idx / (len(path) - 1))
                    point.co = (*v, 1)
                    point.keyframe_insert('co', frame=c.frame(fire + offset))
        flash = ico(f'Shot_{i + 1:02}_DischargeFlash', coll, shot, origin, (.28,) * 3, white)
        visibility(flash, fire, fire + .085, c)
        impact = empty(f'Impact_{i + 1:02}', impacts_coll, impacts, target)
        tele = curves(f'Impact_{i + 1:02}_Telegraph',
                      [ring(c.impact_size, start=j * math.pi / 2, sweep=1.15, points=15) for j in range(4)],
                      .018, violet, impacts_coll, impact)
        visibility(tele, fire - .65, fire, c)
        scale_keys(tele, [(fire - .65, 1.1), (fire, 1)], c)
        core = ico(f'Impact_{i + 1:02}_ImpactCore', impacts_coll, impact, (0, 0, .07), (1, 1, .22), white)
        visibility(core, fire, fire + .17, c)
        scale_keys(core, [(fire, .16), (fire + .04, c.impact_size * .46), (fire + .17, 0)], c, (1, 1, .4))
        burst = curves(f'Impact_{i + 1:02}_RadialBurst', [ring(c.impact_size, .035)], .032, blue, impacts_coll, impact)
        visibility(burst, fire, fire + .29, c)
        scale_keys(burst, [(fire, .15), (fire + .14, 1), (fire + .29, 1.12)], c)
        # A short jagged crown sells the ground strike without a large opaque blast.
        crownpaths = []
        for j in range(6):
            theta = j * math.tau / 6
            crownpaths.append([(0, 0, .06), (.25 * math.cos(theta), .25 * math.sin(theta), .45),
                               (.44 * math.cos(theta + .2), .44 * math.sin(theta + .2), .28),
                               (.66 * math.cos(theta), .66 * math.sin(theta), .70)])
        crown = curves(f'Impact_{i + 1:02}_Crown', crownpaths, .016, blue, impacts_coll, impact)
        visibility(crown, fire, fire + .17, c)
        scale_keys(crown, [(fire, .35), (fire + .08, c.impact_size), (fire + .17, c.impact_size * .8)], c)
        groundpaths, sparkpaths = [], []
        for j in range(9):
            direction = j * math.tau / 9 + rng.uniform(-.13, .13)
            end = (c.impact_size * math.cos(direction), c.impact_size * math.sin(direction), .025)
            points = bolt((0, 0, .025), end, c.seed + i * 41 + j, steps=8, jitter=.11)
            groundpaths.append([(x, y, .025) for x, y, z in points])
            sparkpaths.append([(end[0] * .3, end[1] * .3, .07),
                               (end[0] * .9, end[1] * .9, rng.uniform(.30, .8))])
        ground = curves(f'Impact_{i + 1:02}_GroundArcs', groundpaths, .019, white, impacts_coll, impact)
        visibility(ground, fire, fire + .21, c)
        sparks = curves(f'Impact_{i + 1:02}_Sparks', sparkpaths, .014, blue, impacts_coll, impact)
        visibility(sparks, fire, fire + .25, c)
        scale_keys(sparks, [(fire, .25), (fire + .25, 1.3)], c)
        residualmat = material(f'Impact_{i + 1:02}_ResidualEmission', (.03, .25, 1), 2)
        residue = curves(f'Impact_{i + 1:02}_ResidualElectricity', groundpaths[::2], .013, residualmat, impacts_coll, impact)
        visibility(residue, fire + c.residual_duration * .18 / .55, fire + c.residual_duration, c)
        emission_keys(residualmat, [(fire + c.residual_duration * .18 / .55, 3),
                                   (fire + c.residual_duration * .28 / .55, .6),
                                   (fire + c.residual_duration * .34 / .55, 1.8),
                                   (fire + c.residual_duration, 0)], c)


def main():
    c.validate()
    # Must run in a disposable factory-startup process, never clear an artist session.
    if bpy.data.filepath:
        raise RuntimeError('Use a fresh --factory-startup background process.')
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.name = 'Orbital Lightning | VFX Study'
    asset = collection('ASSET_OrbitalLightning', scene.collection)
    root = empty('OrbitalLightning_ROOT', asset)
    for name, value in vars(c).items():
        root[name] = value
    root['editing'] = 'config.py is the regeneration source. Custom properties document the baked settings.'
    empty('BossCenterReference', asset, root)
    blue = material('Electric_Cobalt', (.006, .10, 1), 3 * c.emission_intensity)
    white = material('Lightning_WhiteHot', (.52, .85, 1), 12 * c.emission_intensity)
    violet = material('Telegraph_Indigo', (.15, .12, .65), 2 * c.emission_intensity)
    build_orbs(collection('Orbs', asset), root, blue, white, violet)
    build_charge(collection('ChargeEffects', asset), root, blue, violet)
    build_shots(collection('Shots', asset), collection('Impacts', asset), root, blue, white, violet)
    from preview import setup
    setup(scene, c)
    linear_animation()
    scene.render.fps = c.fps
    scene.frame_start = 1
    scene.frame_end = c.frame(c.finish)
    for label, t in [('SUMMON', 0), ('CHARGE', c.summon_duration),
                     *[(f'FIRE_{i + 1:02}', c.shot(i)) for i in range(c.orb_count)],
                     ('CLEAN_END', c.finish)]:
        scene.timeline_markers.new(label, frame=c.frame(t))
    scene.frame_set(c.frame(c.first_shot))
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
    for source in ('config.py', 'primitives.py', 'build.py', 'preview.py'):
        text = bpy.data.texts.new(source)
        text.write((HERE / source).read_text(encoding='utf-8'))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'OrbitalLightning.blend'), compress=True)
    (HERE / 'timing.json').write_text(json.dumps({
        'settings': vars(c), 'duration': c.finish,
        'shots': [{'orb': i + 1, 'seconds': c.shot(i), 'frame': c.frame(c.shot(i))} for i in range(c.orb_count)],
        'scope': 'VFX preview only; no targeting, damage, collision or combat logic'
    }, indent=2), encoding='utf-8')
    print('ORBITAL_LIGHTNING_BUILD_OK', len(asset.all_objects), 'asset objects')


if __name__ == '__main__':
    main()
