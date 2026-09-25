# Minova Cinema Desktop — Third-party notices

## mpv

Minova Cinema Desktop bundles `libmpv-2.dll` for native Windows video decoding and rendering inside the application window.

- Project: https://mpv.io/
- Source: https://github.com/mpv-player/mpv
- Windows build: https://github.com/zhongfly/mpv-winbuild
- Pinned build: `2026-09-20-e76a35ec95`, x86-64
- Archive SHA-256: `E09EC2F5D68C5E84C0EE8131650E02313361BE2D30D3BD1E02A1C7DB4735B0F8`
- Bundled executable SHA-256: `00DBC8D366979660EDA0B174CFC2BD596B59A096D91668D6EC6FB23BF77BF72C`

The bundled build and Minova Cinema Desktop are distributed under GPL-compatible terms. Source and build instructions are available at the links above.

## ArtCNN

High and Ultra picture modes include ArtCNN GLSL shaders executed by mpv's native GPU renderer.

- Project: https://github.com/Artoriuz/ArtCNN
- Bundled release: `v1.6.2`
- `ArtCNN_C4F16.glsl` SHA-256: `03D0B3D31CB82C898A94A46663021A3E8F02C5A21D69C5CFDF0208DE4BFD453E`
- `ArtCNN_C4F32.glsl` SHA-256: `F773BCE6CF5FE7E5E5D599A695EDD40DF5CD7A20C3D08C4D164D07591D5BEAD3`
- License: MIT; a copy is included under `vendor/licenses/ArtCNN-MIT.txt`.

## electron-updater

Minova Cinema Desktop uses `electron-updater` to retrieve checksum-verified update metadata and release assets from the official GitHub repository.

- Project: https://github.com/electron-userland/electron-builder
- Package: `electron-updater` 6.6.2
- License: MIT
