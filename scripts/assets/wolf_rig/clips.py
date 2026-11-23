"""Every clip the wolves ship: what it is built from and how its layers move.

The clip NAMES are the game's contract (src/render/characters/manifest.ts:
WOLF_BAKED picks Idle, Walk, Gallop, Attack, the two hit reacts,
Death, Sit and Fall), and every old clip is rebuilt, the unused ones included
(Idle Alert, Sneak, Bark, Howl, Jump), so the set matches what shipped.

One deliberate change: the old Idle_HitReact_Left and Idle_HitReact_Right were
byte-for-byte copies of the 2.8 s Bark, so a struck wolf barked for over two
seconds every time it was hit. They are authored here as real flinches, a short
recoil away from the side the blow came from, on the idle stance.

The mouth never opens: it stays shut as the body was modeled.

Layer settings (see layers.py, animate.py):
  gait                 every paw touches down at the bottom of its stride (the old
                       Gallop never brought its hind paws down to its own ground)
  tail_up / tail_down  the share of the old clip's tail lift / drop kept: the new
                       tail already hangs in its natural curl and only leans with
                       the clip, it is not thrown around
  tail_lo / tail_hi    the carriage never leaves this band (degrees)
  tail_yaw, tail_yaw_max   the share of the old side sweep kept, and its limit
  tail_sway            (degrees, cycles per clip) of side-to-side swing added
  ears_L/ears_R        fold curves, (seconds, degrees): + back, - perked forward
  swivel               ear swivel curve (seconds, degrees): + openings outward
  limp                 0..1 curve: the tail stops being carried and drapes (Death)
"""
from dataclasses import dataclass, field


@dataclass
class Recipe:
    name: str
    source: str | None
    loop: bool
    gait: bool = False
    tail_up: float = 0.45
    tail_down: float = 0.35
    tail_lo: float = -22.0
    tail_hi: float = 30.0
    tail_yaw: float = 0.35
    tail_yaw_max: float = 16.0
    tail_sway: tuple = (0.0, 1)
    ears_L: list = field(default_factory=lambda: [(0.0, 0.0)])
    ears_R: list | None = None
    swivel: list = field(default_factory=lambda: [(0.0, 0.0)])
    hit_side: float = 0.0  # authored hit react: +1 struck on the left, -1 on the right
    length: float = 0.0    # authored clip length in seconds
    limp: list = field(default_factory=lambda: [(0.0, 0.0)])

    @property
    def ears_right(self):
        return self.ears_R if self.ears_R is not None else self.ears_L


RECIPES = [
    Recipe('Idle', 'Idle', loop=True, tail_sway=(4.0, 1),
           ears_L=[(0.0, 0.0), (0.52, 0.0), (0.6, 20.0), (0.7, -4.0), (0.84, 0.0)],
           ears_R=[(0.0, 0.0)]),
    Recipe('Idle Alert', 'Idle Alert', loop=False,
           ears_L=[(0.0, 0.0), (0.25, -12.0), (1.6, -10.0)],
           swivel=[(0.0, 0.0), (0.3, 16.0), (0.8, -8.0), (1.25, 10.0), (1.6, 0.0)]),
    Recipe('Walk', 'Walk', loop=True, gait=True, tail_sway=(6.0, 1), ears_L=[(0.0, 6.0)]),
    Recipe('Sneak', 'Sneak', loop=True, gait=True, tail_sway=(3.0, 1), ears_L=[(0.0, 30.0)]),
    Recipe('Gallop', 'Gallop', loop=True, gait=True, tail_up=0.3, tail_down=0.25,
           ears_L=[(0.0, 45.0)]),
    Recipe('Attack', 'Attack', loop=False,
           ears_L=[(0.0, 6.0), (0.18, 40.0), (0.6, 44.0), (0.867, 18.0)]),
    Recipe('Idle_HitReact_Left', None, loop=False, hit_side=1.0, length=0.7),
    Recipe('Idle_HitReact_Right', None, loop=False, hit_side=-1.0, length=0.7),
    Recipe('Bark', 'Bark', loop=False, ears_L=[(0.0, 0.0), (0.3, -8.0), (2.8, -6.0)]),
    Recipe('Howl', 'Howl', loop=False, ears_L=[(0.0, 0.0), (0.5, 22.0), (2.333, 18.0)]),
    Recipe('Sit', 'Sit', loop=True, tail_sway=(2.0, 1), ears_L=[(0.0, 0.0)]),
    Recipe('Jump', 'Jump', loop=False, ears_L=[(0.0, 0.0), (0.5, 26.0), (1.6, 28.0), (2.2, 6.0)]),
    Recipe('Fall', 'Fall', loop=True, ears_L=[(0.0, 32.0)]),
    Recipe('Death', 'Death', loop=False,
           ears_L=[(0.0, 0.0), (0.45, 24.0), (1.167, 30.0)],
           limp=[(0.0, 0.0), (0.42, 0.0), (0.75, 1.0)]),
]

BY_NAME = {r.name: r for r in RECIPES}
