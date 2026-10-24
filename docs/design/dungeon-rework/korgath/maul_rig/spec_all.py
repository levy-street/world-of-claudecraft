"""Every Korgath maul clip the donor carries (run_clip.py spec_all)."""
import spec_left
import spec_slam
import spec_sweep


def build(rig):
    out = {}
    out.update(spec_slam.build(rig))
    out.update(spec_sweep.build(rig))
    out.update(spec_left.build(rig))
    return out
