# Minova Cinema Desktop 1.0.4

This release adds secure Plex browser sign-in and automatic server discovery while preserving the established Minova Cinema interface and native playback experience.

## Highlights

- Adds official Plex browser sign-in without requiring the Plex desktop or mobile app and without copying a Plex token.
- Opens Plex's prefilled four-character link page in the default browser and keeps a visible manual code and reopen action in Minova.
- Discovers owned and shared Plex Media Servers automatically, offers a clean server chooser, and prefers local, direct-remote, then relay connections.
- Keeps advanced manual server and token setup for reverse proxies, Tailscale, and custom addresses.
- Creates a stable per-install Plex client identity and uses it consistently for discovery, browsing, playback, transcodes, and saved sessions.
- Encrypts the selected server token with Windows secure storage; account tokens never enter the renderer or settings file.
- Preserves the redesigned interface, mini player, native libmpv playback, automatic recovery, and in-app updater from 1.0.3.

Users on 1.0.0 need to install a newer build manually once because 1.0.0 did not contain the updater. Versions 1.0.2 and newer can discover and install this release from inside the app.

## Installer verification

`Minova-Cinema-Desktop-1.0.4-Setup.exe`

SHA-256: `7296A71B71703DDC3308BAB5B906F0C69AF5D93EE5F0383EB08D85F2499BA63E`
