# Minova Cinema Desktop 1.0.1

This maintenance release fixes Plex connections through portless HTTPS addresses such as Tailscale Serve and reverse proxies.

## Fixes

- Portless `https://` server addresses now correctly use HTTPS port 443 instead of being rewritten to Plex port 32400.
- Connection failures now explain which server could not be reached and suggest checking the PC's VPN or Tailscale connection.
- Renderer errors no longer expose Electron's internal remote-method error prefix.
- Adds automatic GitHub update checks, download progress, and an **Install and restart** action in Settings.

Users on 1.0.0 need to install this release manually once because 1.0.0 did not contain the updater. Releases after 1.0.1 can update automatically.

## Installer verification

`Minova-Cinema-Desktop-1.0.1-Setup.exe`

SHA-256: `7BAB1037A8C5D882E2088E112082112F0DEFF8DADD27A61594D70ADA875687C0`
