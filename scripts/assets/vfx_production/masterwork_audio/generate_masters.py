"""Original deterministic material sound design. NumPy only; no borrowed audio.

Usage: python generate_masters.py
Creates editable 24-bit PCM masters and independently adjustable layer stems.
Charge layers are periodic two-second signals, not one-shot ramps replayed in a loop.
"""
from pathlib import Path
import hashlib
import json
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent
SR = 44100
TAU = 2 * np.pi
DESIGNS = {
    'pyroblast': ('pyre', 0.90, 3.20, 'Contained furnace pressure, tearing flame launch, deep combustion and falling cinders'),
    'frost_nova': ('glacier', 0.72, 2.85, 'Crystalline stress, radial ice fracture, irregular shards and cold airborne dust'),
    'chain_lightning': ('thunder', 0.64, 3.10, 'Coronal charge, braided electrical discharge, branching crack and rolling thunder'),
    'chain_heal': ('tide', 1.05, 3.10, 'Suspended water circulation, fluid ribbon release, restorative liquid bloom and droplets'),
    'ghost_wolf': ('wolf', 1.10, 2.80, 'Breathy spectral gathering, organic wolf-like formant motion, soft transformation and spirit wake'),
    'hammer_of_wrath': ('judgement', 0.96, 3.40, 'Suspended radiant metal, broad air-cut, deep struck bronze and luminous alloy resonance'),
    'execute': ('execution', 0.66, 1.90, 'Tensioned steel and leather movement, accelerating heavy blade, dry contact and falling grit'),
    'abyssal_rift': ('rift', 1.16, 3.60, 'Hollow spatial pressure, twisting torn-air release, implosive cavity and unstable dark residue'),
}


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def unit(x, level=1.0):
    return x * (level / max(rms(x), 1e-12))


class Sound:
    def __init__(self, duration, seed, loop=False):
        self.n = round(duration * SR)
        self.t = np.arange(self.n) / SR
        self.duration = self.n / SR
        self.rng = np.random.default_rng(seed)
        self.loop = loop
        self.layers = {}

    def noise(self, low, high, slope=0, seed=None):
        rng = self.rng if seed is None else np.random.default_rng(seed)
        freq = np.fft.rfftfreq(self.n, 1 / SR)
        spec = rng.normal(size=len(freq)) + 1j * rng.normal(size=len(freq))
        mask = np.clip((freq - low * .6) / max(low * .4, 1), 0, 1)
        mask *= np.clip((high * 1.2 - freq) / max(high * .2, 1), 0, 1)
        mask *= np.maximum(freq, 30) ** slope
        spec *= mask
        spec[0] = 0
        return unit(np.fft.irfft(spec, self.n))

    def tone(self, frequency, depth=0, mod=.5):
        # Integer cycles make every charge oscillator wrap without a restart.
        if self.loop:
            frequency = round(frequency * self.duration) / self.duration
            mod = round(mod * self.duration) / self.duration
        return np.sin(TAU * frequency * self.t + depth * np.sin(TAU * mod * self.t))

    def decay(self, tau, attack=.0015):
        return (1 - np.exp(-self.t / attack)) * np.exp(-self.t / tau)

    def sweep(self, start, finish, tau, decay, attack=.001):
        phase = finish * self.t + (start - finish) * tau * (1 - np.exp(-self.t / tau))
        return np.sin(TAU * phase) * self.decay(decay, attack)

    def modes(self, base, ratios, decay, attack=.002, drift=0):
        out = np.zeros(self.n)
        for k, ratio in enumerate(ratios):
            f = base * ratio
            out += self.sweep(f * (1 + drift), f, .06, decay / (1 + k * .35), attack) / (1 + k * .7)
        return out

    def grains(self, count, low, high, tau, end=None, strength=1, kind='dust'):
        out = np.zeros(self.n)
        end = self.duration if end is None else end
        positions = self.rng.uniform(0, end, count)
        for at in positions:
            size = min(self.n, max(32, int(SR * tau * 7)))
            t = np.arange(size) / SR
            frequency = self.rng.uniform(low, high)
            env = (1 - np.exp(-t * 1800)) * np.exp(-t / (tau * self.rng.uniform(.45, 1.3)))
            if kind == 'bubble':
                phase = frequency * (t + .30 * tau * (1 - np.exp(-t / tau)))
                sample = np.sin(TAU * phase) * env
            elif kind == 'glass':
                sample = (np.sin(TAU * frequency * t) + .38 * np.sin(TAU * frequency * 1.713 * t)) * env
            else:
                sample = (self.rng.uniform(-1, 1, size) * .7 + np.sin(TAU * frequency * t) * .3) * env
            amplitude = self.rng.uniform(.18, 1) * strength
            if not self.loop:
                amplitude *= np.exp(-at / max(.1, end * .66))
            start = int(at * SR)
            if self.loop:
                np.add.at(out, (np.arange(size) + start) % self.n, sample * amplitude)
            else:
                stop = min(self.n, start + size)
                out[start:stop] += sample[:stop-start] * amplitude
        return out

    def add(self, name, samples, level):
        self.layers[name] = samples * level


def body(sound, key, phase):
    s, t = sound, sound.t
    charge = phase == 'charge'
    release = phase == 'release'
    if key == 'pyre':
        if charge:
            s.add('furnace_pressure', s.noise(36, 360, -.4) * (.72 + .18 * s.tone(1)), .32)
            s.add('turbulent_flame', s.noise(380, 2100, -.35) * (.64 + .18 * s.tone(3.5)), .16)
            s.add('ember_crackle', s.grains(68, 1800, 6400, .008), .20)
            s.add('contained_resonance', s.tone(62, .25, 1) + .25 * s.tone(126), .075)
        elif release:
            s.add('pressure_launch', s.sweep(115, 44, .065, .16), .75)
            s.add('flame_tear', s.noise(140, 4900, -.30) * s.decay(.25) * (1 + .28 * np.sin(TAU * 44 * t)), .36)
            s.add('hot_air', s.noise(500, 3000) * s.decay(.43, .008), .11)
            s.add('cinder_spray', s.grains(32, 1900, 7100, .012, .55), .24)
        else:
            s.add('combustion_contact', s.noise(120, 5300, -.65) * s.decay(.075), .52)
            s.add('expanding_pressure', s.sweep(82, 34, .14, .50), .60)
            s.add('rolling_fire', s.noise(38, 1750, -.45) * s.decay(.85, .008) * (1 + .22 * np.sin(TAU * 17 * t)), .30)
            s.add('ember_debris', s.grains(116, 1400, 6800, .013, 2.8), .24)
            s.add('cooling_air', s.noise(250, 1950) * s.decay(.95, .11), .07)
    elif key == 'glacier':
        if charge:
            s.add('frozen_air', s.noise(1600, 6500) * (.7 + .22 * s.tone(1.5)), .15)
            s.add('ice_tension', s.tone(823, .23, 2) + .35 * s.tone(1371, .15, .5), .065)
            s.add('crystal_growth', s.grains(42, 900, 5700, .035, kind='glass'), .31)
            s.add('deep_glacial_stress', s.noise(115, 490, -.4) * (.5 + .3 * s.tone(2.5)), .10)
        elif release:
            s.add('radial_fracture', s.noise(700, 9000, -.05) * s.decay(.05), .35)
            s.add('icy_split', s.modes(587, [1, 1.397, 1.924, 2.681, 4.227], .21, drift=.02), .42)
            s.add('cold_pressure', s.sweep(230, 78, .05, .16), .34)
            s.add('shard_departure', s.grains(65, 1800, 8000, .018, .60, kind='glass'), .36)
        else:
            s.add('crystal_core_fracture', s.modes(438, [1, 1.423, 1.961, 2.755, 3.813, 5.407], .65, drift=.03), .45)
            s.add('ice_plate_crack', s.noise(420, 9100) * s.decay(.045), .34)
            s.add('ice_mass', s.sweep(152, 64, .07, .24), .38)
            s.add('scattered_shards', s.grains(138, 850, 7250, .052, 2.3, kind='glass'), .29)
            s.add('suspended_ice_dust', s.noise(2200, 8100) * s.decay(.80, .08), .08)
    elif key == 'thunder':
        if charge:
            s.add('corona_hiss', s.noise(1300, 8200) * (.48 + .2 * s.tone(7.5)), .18)
            s.add('charged_coil', s.tone(93, 4.8, 31) + .28 * s.tone(187, 1.3, 7), .12)
            s.add('arcing_contacts', s.grains(54, 1700, 7200, .005), .38)
            s.add('electrical_pressure', s.noise(55, 240, -.4), .12)
        elif release:
            s.add('leader_crack', s.noise(850, 12000) * s.decay(.018, .0003), .68)
            s.add('braided_discharge', s.noise(280, 6900) * s.decay(.14) * (.55 + .45 * np.cos(TAU * 71 * t) ** 2), .36)
            s.add('electric_snap_body', s.sweep(290, 63, .022, .12), .48)
            s.add('traveling_arcs', s.grains(30, 2200, 10000, .004, .38), .39)
        else:
            s.add('branching_contact', s.noise(660, 11500) * s.decay(.023, .0004), .60)
            s.add('thunder_front', s.sweep(105, 34, .11, .50), .56)
            s.add('layered_thunder', s.noise(28, 620, -.55) * s.decay(.94, .016) * (.65 + .28 * np.sin(TAU * 6 * t) ** 2), .39)
            s.add('ground_arcs', s.grains(63, 700, 6600, .009, 1.6), .23)
            s.add('distant_air_roll', s.noise(150, 1500, -.7) * s.decay(.8, .15), .13)
    elif key == 'tide':
        if charge:
            s.add('flowing_water', s.noise(160, 2400, -.3) * (.7 + .22 * s.tone(2)), .17)
            s.add('suspended_droplets', s.grains(76, 450, 3800, .025, kind='bubble'), .42)
            s.add('water_cavity', s.tone(271, .8, 1.5) + .35 * s.tone(459, .35, 2), .055)
            s.add('fine_water_fizz', s.noise(3300, 7000) * (.7 + .18 * s.tone(4)), .075)
        elif release:
            s.add('ribbon_waterfront', s.noise(120, 4500, -.25) * s.decay(.22, .001), .30)
            s.add('fluid_cavity', s.sweep(185, 370, .17, .40, .007), .21)
            s.add('ribbon_droplets', s.grains(64, 650, 4900, .023, .85, kind='bubble'), .45)
            s.add('soft_aeration', s.noise(2800, 8400) * s.decay(.43, .055), .09)
        else:
            s.add('restorative_splash', s.noise(160, 4900, -.2) * s.decay(.13, .001), .23)
            s.add('liquid_bloom', s.modes(357, [1, 1.527, 2.083, 2.713], .72, attack=.012, drift=-.025), .25)
            s.add('water_crown', s.grains(125, 420, 5200, .032, 2.6, kind='bubble'), .37)
            s.add('rising_mist', s.noise(850, 6600, -.25) * s.decay(.77, .10), .09)
            s.add('depth_resonance', s.sweep(122, 191, .28, .4, .018), .16)
    elif key == 'wolf':
        if charge:
            glottal = sum(s.tone(147 * k, .12 * k, .5) / k ** 1.4 for k in range(1, 8))
            s.add('spectral_breath', s.noise(190, 3700, -.6) * (.7 + .22 * s.tone(1)), .22)
            s.add('organic_formant', glottal * (.65 + .18 * s.tone(.5)), .10)
            s.add('fur_rush', s.noise(1900, 7300) * (.5 + .3 * s.tone(2.5)), .075)
            s.add('spirit_pressure', s.tone(49, .30, .5), .085)
        elif release:
            s.add('transform_breath', s.noise(100, 3700, -.55) * s.decay(.33), .33)
            for k in range(1, 8):
                s.add(f'organic_resonance_{k}', s.sweep(178 * k, 104 * k, .16, .42, .003) / k ** 1.6, .21)
            s.add('fur_sweep', s.noise(2800, 7800) * s.decay(.31, .01), .085)
        else:
            s.add('spirit_arrival', s.noise(140, 3000, -.6) * s.decay(.18), .25)
            for k in range(1, 9):
                s.add(f'wolf_formant_{k}', s.sweep(126 * k, 171 * k, .34, .84, .008) / k ** 1.7, .19)
            s.add('breathing_wake', s.noise(450, 4250, -.55) * s.decay(.89, .075), .17)
            s.add('ethereal_air', s.noise(2500, 7400) * s.decay(.80, .12), .055)
    elif key == 'judgement':
        if charge:
            s.add('suspended_alloy', sum(s.tone(f, .13, .5) / (1 + i) for i, f in enumerate([293, 607, 839, 1289, 1777])), .12)
            s.add('radiant_pressure', s.noise(180, 1650, -.4) * (.7 + .18 * s.tone(1.5)), .15)
            s.add('metallic_glints', s.grains(37, 1300, 6700, .029, kind='glass'), .22)
            s.add('air_lift', s.noise(3100, 9000) * (.7 + .15 * s.tone(3)), .055)
        elif release:
            s.add('hammer_aircut', s.noise(95, 4700, -.4) * s.decay(.24), .32)
            s.add('radiant_edge', s.modes(673, [1, 1.521, 2.172, 3.143], .34, drift=.025), .22)
            s.add('heavy_weapon_body', s.sweep(201, 68, .05, .18), .35)
            s.add('high_metal_shear', s.noise(2700, 8000) * s.decay(.12), .07)
        else:
            s.add('bronze_contact', s.noise(480, 8100, -.1) * s.decay(.032), .34)
            s.add('hammer_mass', s.sweep(142, 53, .055, .32), .46)
            s.add('struck_sacred_alloy', s.modes(271, [1, 2.023, 2.756, 4.081, 5.373, 6.842], 1.12, drift=.005), .38)
            s.add('metal_sparks', s.grains(54, 1650, 6400, .028, 1.6, kind='glass'), .16)
            s.add('radiant_decay', s.noise(1350, 6900, -.5) * s.decay(.70, .035), .075)
    elif key == 'execution':
        if charge:
            s.add('tensioned_steel', s.noise(780, 4300, -.1) * (.25 + .6 * np.maximum(0, s.tone(1.5)) ** 3), .11)
            s.add('leather_weight_shift', s.noise(140, 780, -.5) * (.5 + .25 * s.tone(2)), .19)
            s.add('blade_stress', s.tone(193, .4, .5) + .25 * s.tone(1237, .15, 1), .055)
            s.add('grip_friction', s.grains(24, 300, 2100, .012), .20)
        elif release:
            s.add('heavy_blade_cut', s.noise(170, 7800, -.2) * s.decay(.105, .0008), .39)
            s.add('weapon_inertia', s.sweep(294, 59, .038, .14), .39)
            s.add('steel_edge', s.modes(1359, [1, 1.641, 2.336], .11, drift=-.02), .15)
            s.add('leather_followthrough', s.noise(220, 1500, -.5) * s.decay(.24, .014), .13)
        else:
            s.add('dry_contact', s.noise(350, 7600, -.1) * s.decay(.028, .0007), .37)
            s.add('weight_transfer', s.sweep(156, 46, .037, .23), .57)
            s.add('armour_ring', s.modes(349, [1, 2.713, 4.391, 6.087], .32, drift=.045), .18)
            s.add('falling_grit', s.grains(84, 570, 5300, .007, 1.35), .25)
            s.add('impact_air', s.noise(80, 620, -.4) * s.decay(.21, .011), .21)
    elif key == 'rift':
        if charge:
            s.add('void_cavity', s.tone(51, 2.1, 1) + .45 * s.tone(83, 1.7, .5), .15)
            s.add('twisting_air', s.noise(105, 1600, -.6) * (.5 + .38 * s.tone(3.5) ** 2), .23)
            s.add('ragged_boundary', s.noise(900, 4900, -.3) * (.2 + .6 * np.maximum(0, s.tone(6.5)) ** 2), .11)
            s.add('unstable_residue', s.grains(35, 360, 2500, .021, kind='bubble'), .18)
        elif release:
            s.add('spatial_tear', s.noise(140, 7700, -.25) * s.decay(.20) * (.5 + .5 * np.sin(TAU * 29 * t) ** 2), .35)
            s.add('pressure_inversion', s.sweep(70, 257, .20, .37), .34)
            s.add('cavity_opening', s.modes(163, [1, 1.317, 2.213, 3.527], .46, drift=-.20), .20)
            s.add('ragged_edges', s.grains(48, 430, 4800, .017, .88), .21)
        else:
            s.add('implosion_contact', s.noise(160, 5800, -.4) * s.decay(.040), .38)
            s.add('void_pressure', s.sweep(132, 30, .19, .62), .53)
            s.add('unstable_cavity', s.modes(83, [1, 1.311, 2.273, 3.613], 1.0, drift=.3), .18)
            s.add('torn_dark_air', s.noise(85, 2900, -.6) * s.decay(.99, .035) * (.63 + .28 * np.sin(TAU * 11 * t) ** 2), .25)
            s.add('rift_debris', s.grains(76, 180, 2800, .022, 2.8, kind='bubble'), .22)


def trim_band(x):
    freq = np.fft.rfftfreq(len(x), 1 / SR)
    # All spectral processing remains periodic for loop masters.
    mask = np.clip((freq - 25) / 17, 0, 1) * np.clip((17500 - freq) / 2200, 0, 1)
    return np.fft.irfft(np.fft.rfft(x) * mask, len(x))


def late_space(x, length, seed):
    rng = np.random.default_rng(seed)
    n = len(x)
    ir_n = round(length * SR)
    impulse = np.zeros(ir_n)
    # A diffuse, non-musical late field; dry attack remains separate and dominant.
    positions = rng.integers(round(.026 * SR), ir_n, max(140, ir_n // 30))
    impulse[positions] = rng.uniform(-1, 1, len(positions)) * np.exp(-positions / (SR * length * .23))
    impulse /= max(np.sqrt(np.sum(impulse ** 2)), 1e-8)
    total = 1 << (n + ir_n - 2).bit_length()
    return np.fft.irfft(np.fft.rfft(x, total) * np.fft.rfft(impulse, total), total)[:n]


def write_wav(path, samples):
    pcm = np.round(np.clip(samples, -1, 1) * 8388607).astype(np.int32)
    packed = np.empty((len(pcm), 3), dtype=np.uint8)
    for i in range(3):
        packed[:, i] = (pcm >> (8 * i)) & 255
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(3)
        out.setframerate(SR)
        out.writeframes(packed.tobytes())


def main():
    entries = []
    for index, (ability, (identity, release, impact, description)) in enumerate(DESIGNS.items()):
        for phase, duration in [('charge', 2.0), ('release', release), ('impact', impact)]:
            seed = 71001 + index * 997 + ['charge', 'release', 'impact'].index(phase) * 193
            s = Sound(duration, seed, phase == 'charge')
            body(s, identity, phase)
            raw = np.sum(list(s.layers.values()), axis=0)
            if phase != 'charge':
                s.layers['diffuse_material_tail'] = late_space(raw, .36 if phase == 'release' else .85, seed+1) * (.075 if identity == 'execution' else .12)
            # Soft saturation catches coincident stochastic grains before common peak scaling.
            mixed = trim_band(np.sum(list(s.layers.values()), axis=0))
            mixed = np.tanh(mixed * .95) / .95
            if phase != 'charge':
                # Contact at sample zero, with a sub-millisecond anti-click start only.
                fade_in = min(44, len(mixed))
                mixed[:fade_in] *= np.linspace(0, 1, fade_in)
                fade_out = min(round(.11 * SR), len(mixed))
                mixed[-fade_out:] *= np.linspace(1, 0, fade_out) ** 2
            gain = .398107 / max(float(np.max(np.abs(mixed))), 1e-10)
            mixed *= gain
            if s.loop:
                # MP3 has codec startup/end padding. An interior 1s..3s window
                # retains a genuinely periodic 2s cycle after lossy encoding.
                mixed = np.tile(mixed, 2)
            prefix = {'charge': 'cast', 'release': 'proj', 'impact': 'impact'}[phase]
            key = f'{prefix}_masterwork_{identity}'
            path = ROOT / 'masters' / f'{key}.wav'
            write_wav(path, mixed)
            for name, stem in s.layers.items():
                write_wav(ROOT / 'stems' / key / f'{name}.wav', (np.tile(stem, 2) if s.loop else stem) * gain * .6)
            entries.append({
                'ability': ability, 'identity': identity, 'phase': phase, 'key': key,
                'file': f'runtime/{key}.mp3', 'master': f'masters/{key}.wav',
                'durationSeconds': 4.0 if s.loop else duration, 'sampleRate': SR, 'channels': 1,
                'masterBitDepth': 24, 'seed': seed, 'loop': phase == 'charge',
                'loopStart': 1 if phase == 'charge' else None,
                'loopEnd': 3 if phase == 'charge' else None,
                'loopPeriodSeconds': 2 if phase == 'charge' else None,
                'startOffsetSeconds': 1 if phase == 'charge' else 0,
                'playbackRate': 1,
                'attackAtSeconds': 0, 'runtimeFadeInSeconds': .055 if phase == 'charge' else 0,
                'runtimeFadeOutSeconds': .10 if phase == 'charge' else 0,
                'recommendedRuntimeGain': .28 if phase == 'charge' else .60 if phase == 'release' else .72,
                'randomPitchRecommended': False, 'description': description,
                'layers': list(s.layers), 'stemGainVsMixInput': .6,
                'mixProcessing': 'Sum layers; spectral 25Hz highpass/17.5kHz lowpass; tanh saturation; -8dBFS source sample peak; one-shot edge fades; linear peak-constrained loudness normalization and canonical conformance checks during packaging',
                'masterSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'sourceSamplePeakDbfs': float(20 * np.log10(np.max(np.abs(mixed)))),
                'sourceRmsDbfs': float(20 * np.log10(rms(mixed))),
                'sourceLoopSeamDelta': float(abs(mixed[0] - mixed[-1])) if s.loop else None,
                'provenance': 'Original offline procedural sound design using seeded noise, physical modal resonators, FM/formant synthesis, granular liquid/crystal events, and a sparse diffuse response. No external audio samples, model services, music, voices, or private credentials.'
            })
            print(key, duration, len(s.layers))
    (ROOT / 'asset_manifest.json').write_text(json.dumps({'version': 1, 'sampleRate': SR, 'entries': entries}, indent=2) + '\n')


if __name__ == '__main__':
    main()
