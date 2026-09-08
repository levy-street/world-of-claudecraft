"""Numerical review of decoded material detail, envelope and interior loop seams."""
from pathlib import Path
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parent
FFMPEG = (ROOT / '../woc-vfx-studio/node_modules/ffmpeg-static/ffmpeg.exe').resolve()
manifest = json.loads((ROOT / 'asset_manifest.json').read_text())
validation = json.loads((ROOT / 'validation.json').read_text())
band_edges = [25, 80, 180, 450, 1000, 2500, 6000, 12000, 18000]
for entry in manifest['entries']:
    raw = subprocess.check_output([str(FFMPEG), '-v', 'error', '-i', str(ROOT / entry['file']), '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'])
    samples = np.frombuffer(raw, dtype='<f4').astype(float)
    power = abs(np.fft.rfft(samples)) ** 2
    frequencies = np.fft.rfftfreq(len(samples), 1 / 44100)
    bands = [float(power[(frequencies >= a) & (frequencies < b)].sum()) for a, b in zip(band_edges, band_edges[1:])]
    row = {
        'bandEdgesHz': band_edges,
        'bandEnergyFraction': [round(v / sum(bands), 4) for v in bands],
        'spectralCentroidHz': round(float((power * frequencies).sum() / power.sum()), 1),
        'first20msRms': round(float(np.sqrt(np.mean(samples[:882] ** 2))), 6),
        'last20msRms': round(float(np.sqrt(np.mean(samples[-882:] ** 2))), 6),
    }
    if entry['loop']:
        start = round(entry['loopStart'] * 44100)
        end = round(entry['loopEnd'] * 44100)
        mismatch = abs(samples[start] - samples[end])
        normal_step = np.sqrt(np.mean(np.diff(samples) ** 2))
        row.update(loopPhaseMismatch=float(mismatch), loopPhaseMismatchDbfs=round(float(20 * np.log10(max(mismatch, 1e-12))), 2), loopPhaseMismatchVsNormalStep=round(float(mismatch / normal_step), 4))
        assert mismatch < .015, (entry['key'], mismatch)
    else:
        assert row['last20msRms'] < .001, (entry['key'], row)
    for result in validation['results']:
        if result['key'] == entry['key']:
            result['materialReview'] = row
validation['runtimeBudgetBytes'] = 2 * 1024 * 1024
validation['losslessMasterCount'] = len(list((ROOT / 'masters').glob('*.wav')))
validation['editableStemCount'] = len(list((ROOT / 'stems').glob('*/*.wav')))
validation['loopConvention'] = {'startOffset': 1, 'loopStart': 1, 'loopEnd': 3, 'period': 2, 'playbackRate': 1, 'pitchJitter': False}
validation['materialReviewPassed'] = True
(ROOT / 'validation.json').write_text(json.dumps(validation, indent=2) + '\n')
print(json.dumps({key: validation[key] for key in ['allPassed', 'assetCount', 'runtimeBytes', 'losslessMasterCount', 'editableStemCount', 'materialReviewPassed']}))
