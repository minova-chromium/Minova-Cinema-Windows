# Minova Cinema Desktop 1.1.0

This update keeps Minova Cinema useful during an internet outage when your Windows PC can still reach its Plex server over the local network, and makes offline libraries retain their artwork.

## Highlights

- Discovers the saved Plex server over the local wired or Wi-Fi network and automatically prefers its validated LAN route when available.
- Keeps browsing, artwork, playback, progress, and watched-state updates working locally when the internet or an external Plex address is unavailable.
- Verifies the discovered Plex machine identity before switching routes, so Minova does not connect to a different server on multi-server networks.
- Adds an optional persistent artwork cache for posters, backdrops, and cast images, bounded to 512 MB with usage reporting and a clear-cache action in Settings.
- Retains remote, Tailscale, reverse-proxy, and Plex relay addresses as fallbacks when the local server cannot be reached.
- Smooths season switching and episode loading in the Experimental UI while preserving the Stable UI, native playback, updater, and branded installer.

Users on 1.0.0 need to install a newer build manually once because 1.0.0 did not contain the updater. Versions 1.0.2 and newer can discover and install this release from inside the app.

## Installer verification

`Minova-Cinema-Desktop-1.1.0-Setup.exe`

SHA-256: `91FCD158CA5BC02EE0CD34C0DA57369B0E8CFF7353CD4E5A84389D44B6015D1D`
