# Crucible profession item paintings

The 45 integration icons were generated separately with the built-in image tool,
then normalized and ingested with the canonical item converter. The hammer
follow-up adds one separately generated Forgefather's Ember icon.

Exact prompts, master/source hashes and processing records are in
`generation-report.json`; shipping hashes and byte sizes are in
`shipping-report.json`. Originals and review sheets remain under the ignored
`tmp/imagegen/crucible-professions/` directory. Shipping files live in
`public/ui/items/` and each has one current mapping owner.

Implementation-agent review accepted the new paintings at 128px, 40px, 28px,
22px, in grayscale and in a centered 64px circular crop. All have complete
readable subjects, distinct construction within a consistent collection family,
opaque dark painted grounds and no accidental text or UI frames. The 46 new
shipping files are unique, opaque, 128px WebP; the largest is 4,328 bytes.

The separate hammer deed crest is not accepted. Two built-in candidates painted
a checkerboard into a three-channel image instead of supplying transparency.
They remain unshipped. The deed uses the supported procedural category crest and
is listed in the existing art-pending ledger and commissioning brief.
