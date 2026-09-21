# Warrior impact precision - 21 September 2026

Tony requested a substantial increase in precision, material detail, particles and coherence after v37 achieved a larger scale but looked clunky. This follow-up preserves collision reach and the existing movement, sounds and receiving reactions. Red Harvest retains both opening slashes and damage at +0.50 seconds.

## Authored changes

- Steel: three unequal cut tongues, thin silver lips, torn gaps and independently departing fragments. World strike direction is projected through the actual camera rather than applying a screen-space roll.
- Blood: dark material thickness, one broken wet lip per sheet, early breakup into disconnected ligaments, dark short droplets with selective wet highlights. Twinstrike, Bloodletting, Red Harvest and area blood contacts share this material vocabulary at their own scale.
- Spirit lightning: four unequal leaders with attached forks and fine branches. Branches reveal only after their parent reaches the junction. The bright contact seed expires first.
- Blunt impacts: paired compression shoulders and an original 64-frame Blender sprite for Shieldcrack and Stormbolt, with 18 unequal folded steel fragments, 90 small tumbling chips and a tiny early contact seed. Individual pieces are deliberately smaller than the initial rejected prototype; the cloud retains its existing reach. A weak material tint preserves neutral metal beneath the spirit lightning.
- Sprite frames are 496px with 8px gutters in a 4096px lossless atlas. Source and frame hashes, complete frame coverage, clear endpoints and unclipped extents are validated by the packager. These are original Blender renders, not AI-generated images or new character models.
- Gravity is projected from world-down into the billboard frame. Near-end-on cuts retain their last stable direction. Thin shader rims use derivative filtering.

## Runtime constraints and proof

The existing six flash planes and ten baked sprite slots are reused. Materials and blend state are constructed and prepared before casting; no live texture generation or new scene objects. The new atlas participates in deferred loading, boot preparation and active-kit texture upload. Blood uses dark premultiplied source-over with emissive accents. Other styles preserve source-alpha additive RGB through a fixed blend state, including fixed-point clamp ordering. A real WebGL pixel probe compares default byte and floating render targets; destination alpha is intentionally not claimed equivalent. Reduced-motion shapes freeze while fade and expiry continue.

The 4096px lossless master is encoded as UASTC quality4 KTX2 for runtime, with no RDO and a baked vertical flip. Compression proof measures mean visible RGB error5.34/255 and mean alpha error0.108/255. On BC7/ASTC-capable GPUs the single-level texture occupies roughly16MiB rather than64MiB raw RGBA; fallback formats can differ. It is not a free performance improvement. Normal playback and first-use measurements must accompany the review. Existing first-use stalls and the broader canonical gate remain open until separately proven resolved.

## Review discipline

The first two prototypes were rejected locally: broad neon blood bands looked like cloth, and large bright crush plates looked like floating panels. Keep their captures as evidence; do not present them as final acceptance. Review exact final source at gameplay distance, outdoors, across all six presets and with reduced motion. Preserve before/after provenance and error logs. This is an art-review checkpoint, not a declaration that every Warrior ability is finally AAA.
