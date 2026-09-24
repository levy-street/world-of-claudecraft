"""Art-direction controls. Seconds and Blender meters. No gameplay rules."""
from dataclasses import dataclass
from math import tau


@dataclass(frozen=True)
class Settings:
    orb_count: int = 6
    orbit_radius: float = 3.2
    orbit_height: float = 2.9
    orbit_speed: float = 0.52  # radians / second
    charge_duration: float = 1.8
    shot_delay: float = 0.25
    orb_size: float = 0.46
    orb_brightness: float = 7.0
    lightning_shot_length: float = 4.8  # horizontal outward reach
    lightning_thickness: float = 0.026
    branch_count: int = 5
    impact_size: float = 1.05
    residual_duration: float = 0.55
    emission_intensity: float = 1.0
    summon_duration: float = 0.65
    shot_duration: float = 0.125
    prefire_duration: float = 0.20
    fps: int = 24
    seed: int = 1731

    @property
    def first_shot(self):
        return self.summon_duration + self.charge_duration

    @property
    def finish(self):
        return self.first_shot + (self.orb_count - 1) * self.shot_delay + self.residual_duration + 0.8

    def shot(self, index):
        return self.first_shot + index * self.shot_delay

    def angle(self, index, seconds):
        return -1.25 + tau * index / self.orb_count + self.orbit_speed * seconds

    def frame(self, seconds):
        return round(seconds * self.fps) + 1

    def validate(self):
        assert 4 <= self.orb_count <= 6
        assert self.charge_duration > 0 and self.shot_delay > self.shot_duration
        assert self.orbit_radius > self.orb_size * 2 and self.orbit_height > self.orb_size
        assert self.residual_duration > 0 and self.fps >= 24
        assert self.branch_count >= 0 and self.lightning_thickness > 0


CFG = Settings()
