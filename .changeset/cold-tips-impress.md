---
"@jlcpcb/cli": patch
"@jlcpcb/core": patch
"@jlcpcb/mcp": patch
---

Fix EasyEDA 3D model transform import so KiCad footprints preserve model offsets and rotations.

Improve CLI table formatting so search and library rows keep aligned columns, including with wide characters.

Add workspace lint scripts and ESLint configuration so `bun run lint` works across packages.
