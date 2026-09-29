# Minova Cinema Desktop

The Windows edition mirrors the Android TV 2.9 visual language while adapting it for mouse, keyboard, and living-room remote input.

## Features

- Secure Plex browser sign-in with automatic owned/shared server discovery and local-first connection selection.
- Advanced manual connection for reverse proxies, Tailscale, and custom Plex server addresses.
- Windows-encrypted Plex token; the renderer never receives the token.
- Continue Watching, discovery shelves, Movies, Series, Collections, Watchlist, and search.
- Personalized Home discovery, complete genre shelves and filtering, clean edge-arrow shelf controls, and an alphabetical grid with A–Z keyboard jumping.
- Movie, series, season, and episode details.
- Series Play/Resume automatically selects an in-progress episode, the next unwatched episode, or episode one for a fresh series.
- Embedded libmpv Direct Play with automatic Plex HLS conversion fallback.
- D3D11 hardware decoding, native audio/subtitle track discovery, precise seeking, and fullscreen playback.
- GPU scaling plus optional ArtCNN High and Ultra shader modes for 1080p-and-lower video.
- Plex timeline progress plus watched and Watchlist updates.
- Continue elsewhere handoff with confirmed Plex progress saving and foreground Continue Watching refresh.
- Automatic update checks and in-app installation from official GitHub Releases.
- Continuous or separated A–Z grid organization, Arrow-key navigation, Enter, Escape/Backspace, Ctrl+F search, and fullscreen controls.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

`pnpm demo` opens a credential-free visual demo. Demo playback is deliberately disabled.

## Packaging

Minova Cinema Desktop supports 64-bit Windows 10 and Windows 11. Build the installer from this repository with:

```powershell
pnpm install --frozen-lockfile
pnpm run dist
```

The installer is written to `dist`. During packaging, the build scripts download the checksum-pinned libmpv runtime and compile the native Windows host automatically.

The browsing interface is rendered by Electron, but video is not played through Chromium. A pinned `libmpv-2.dll` is loaded by Minova's native Windows media host and renders into a child HWND inside the main Electron window. The child surface has no separate top-level window, taskbar entry, focus target, or independent close button. Electron supplies the cinema-styled playback controls above that embedded surface.

libmpv is controlled over a private local IPC pipe. The Plex token remains in the main process and is never exposed to the renderer or placed on a process command line. `scripts\Get-LibMpv.ps1` verifies the pinned runtime checksum, and `scripts\Build-LibMpvHost.ps1` compiles the small Win32 child-window host automatically before packaging.

The desktop application uses the separate application ID `com.minova.cinema.desktop`; it does not change the Android application ID, APK signing key, or Android release pipeline.

Installed production builds check the public `minova-chromium/Minova-Cinema-Windows` GitHub Releases feed shortly after launch and every six hours while running. Updates download in the background and can be installed from Settings with **Install and restart**. Release assets must include the generated installer, blockmap, and `latest.yml` metadata.

## License

Minova Cinema Desktop is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE). Third-party component notices are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
