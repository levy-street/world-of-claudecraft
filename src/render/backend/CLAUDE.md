# Render backends

This directory owns renderer selection and backend lifecycle.

- WebGL2 remains the default and complete production path.
- WebGPU is explicit and experimental until scene materials and postprocessing
  have equivalent TSL implementations.
- Selection logic stays pure and testable.
- Backend initialization is atomic. If WebGPU initialization or its compatibility
  probe fails, dispose it before creating the WebGL2 fallback.
- Do not import WebGPU code on the default path. Use a dynamic import.
- Never claim a backend is faster without same-scene measurements.
