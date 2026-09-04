# Kestrel

Live mapping of located devices, directly inside the Kismet web UI.

![logo](https://github.com/SoliForte/Kestrel/blob/master/Kestrel.png)

Kestrel adds a **Map** tab to the main Kismet pane.  Every device Kismet has a
GPS location for is plotted as a marker colour-coded by security, band and
Wi-Fi generation, clustered when zoomed out, and refreshed live as Kismet
sees new devices.  A filter box narrows the map, popups link into Kismet's
device details window, and the GPS position and drive path are drawn as
Kismet reports them.

Built on [Leaflet](https://leafletjs.com) and Font Awesome, both shipped with
Kismet, and [PruneCluster](https://github.com/SINTEF-9012/PruneCluster).
Thanks to those projects, and a huge thanks to Dragorn (@kismetwireless) for
making the plugin system possible and for his help debugging.

[Kestrel in action (original release)](https://www.youtube.com/watch?v=ntG1sJnQLH0)

## Requirements

A current Kismet release.  Kismet now loads web plugins as ES modules and
ships Leaflet itself; Kestrel relies on both.  If you run a Kismet from before
2022, use the previous Kestrel commit (`a6b006b`) instead.

## Installation

Clone this repository:

    git clone https://github.com/soliforte/kestrel
    cd kestrel/plugin-kestrel

Kismet only scans for plugins at startup, and it looks in two places: the
system plugin directory and `~/.kismet/plugins` in the home directory of
**the user Kismet runs as**.  Pick the install that matches how you start
Kismet.

**Kismet runs as root** (`sudo kismet`, or the default systemd service),
which is the usual case since capture needs root.  Install system-wide:

    sudo make install

The system plugin directory comes from `pkg-config --variable=plugindir
kismet`, or from the Kismet source tree in `/usr/src/kismet`, falling back to
`/usr/local/lib/kismet`.  If that directory is writable by your user (Homebrew
on macOS, for example) you can skip `sudo` and set the file ownership to
yourself:

    make install INSTUSR=$(id -un) INSTGRP=$(id -gn)

Do not use `make userinstall` for a root Kismet: it installs into *your*
`~/.kismet/plugins`, which root never reads.

**Kismet runs as your user** (for example replaying logs, or a setup with the
capture helpers running privileged separately).  Install for that user only:

    make userinstall

Then restart Kismet, open the web UI, and the **Map** tab appears next to
**Devices**.  Kismet's startup messages list each plugin it loads; if the tab
is missing, look there for a "Plugin 'Kestrel' loaded" line or a "Did not
find a user plugin directory" warning pointing at the wrong home.

## Using it

- **Tile consent.** The first time the map opens it warns that map tiles will
  be fetched from the Internet.  Tick "Don't warn me again" to skip it.
- **Filter.** The box at the top right of the map shows only matching devices
  (case-insensitive; matches name, SSID, MAC, type, manufacturer, PHY,
  security, channel, band and Wi-Fi generation, so "open", "5 GHz" or
  "wi-fi 6" work).  Searching an SSID shows the access points beaconing it,
  the clients connected to them, and clients probing for it.  Kismet only
  exposes the last beaconed and last probed SSID cheaply, so an access point
  advertising several SSIDs matches on its most recent one.
  A search typed into the Devices tab is carried over to the map filter when
  you switch to the Map tab and the map filter is empty.
- **Markers.** Each device is a coloured disc.  The fill is its security
  class (red Open, orange WEP, yellow WPA, green WPA2, teal WPA3, grey
  unknown), the ring is its band (amber 2.4 GHz, blue 5 GHz, purple 6 GHz),
  the glyph is its type (access point, client, bridge, WDS, ad-hoc,
  Bluetooth), a padlock marks enterprise (802.1X) networks, and a badge shows
  the Wi-Fi generation.  Cluster pies use the same security colours.
- **Wi-Fi generation.** Kismet does not decode 802.11ax/be, so the badge is
  inferred.  A plain number is exact; a trailing `+` means "at least" and
  comes from the channel width and band.  Setting `dot11_keep_ietags=true` in
  `kismet_80211.conf` makes Kismet keep each beacon's IE tag list, which lets
  Kestrel tell Wi-Fi 4 from 5 exactly and spot Wi-Fi 6 or newer.
- **Popups.** Click a marker for name, MAC, type, manufacturer, security,
  channel and band, Wi-Fi generation, signal and last-seen time, plus a link
  to the full device details window.
- **Associations.** Access points carry a blue badge with their associated
  client count.  When a cluster expands, its spiral is ordered so each access
  point is followed by its clients, with a thin line from each client to its
  access point.  A client's popup links to its access point and an access
  point's popup lists the clients on the map.  Kismet only knows an
  association when it saw traffic between the two, so probing-only clients
  stay ungrouped; their popup shows the SSID they are probing for instead.
- **Drones.** Kismet's UAV PHY decodes DJI DroneID broadcasts (over Wi-Fi,
  or over RF with an ANTSDR capture source) and fingerprints other drones by
  SSID and MAC.  Any drone that reports its own position is drawn there, as a
  large disc in its own colour with a nose showing heading, a track of its
  last 128 telemetry points, and, when broadcast, its home point and operator
  position with a dashed line to the operator.  A drone that stops reporting
  fades after a minute.  The popup shows model, serial, altitude, speed,
  heading and operator distance where Kismet has them.  Fingerprinted drones
  without telemetry keep a normal marker with a drone glyph at the spot where
  Kismet heard them.  By default the map jumps to a drone the first time it
  is seen; the Drones checkbox and the settings pane control both behaviours.
- **Map controls** (top right): follow the GPS position, show or hide the
  drive path and drones, fit the view to all shown devices, clear the drive
  path.  Dragging the map turns off follow mode.
- **Legend** (bottom right) explains the security colours, band rings and
  generation badge; the status line (bottom left) shows how many devices and
  drones are plotted, when they last updated, and whether polling has backed
  off.
- The map view is remembered across reloads.

## Settings

Open Kismet's **Settings** and pick **Kestrel Map** to change:

- the tile URL template and attribution, for example to point at a local tile
  server for offline use;
- the maximum zoom level;
- the refresh interval (default 2 seconds; Kismet's own device list polls
  every second, so 1 is fine on a normal server);
- whether the drive path is drawn and whether follow mode starts enabled;
- whether drones are shown and whether the map jumps to a newly seen drone;
- whether the tile warning is shown.

## How it works

- Devices are fetched with Kismet's field simplification, so only the handful
  of fields the map needs cross the wire.  The first load pulls every device;
  later polls ask only for devices active since the previous poll and update
  markers in place, keyed by Kismet's device key.
- A resync once a minute catches anything the incremental polls miss, such
  as replayed logs with old timestamps, and drops devices Kismet has expired.
  It is two-stage to stay cheap on big sessions: a light pass fetches only
  key, last-seen time and position for every device (about 90 bytes each),
  then full records are fetched by key, in batches, only for devices the map
  is missing or whose position moved.  In steady state that second stage is
  empty.  Only the very first load fetches everything in one request.
- New devices are pushed over Kismet's eventbus (`NEW_DEVICE`) the moment
  Kismet creates them, so a new network or drone appears before the next poll.
- Polling adapts to the server.  If an incremental poll takes longer than half
  the configured interval, the interval doubles (up to 30 seconds) and the
  status line says so; it decays back once responses are quick again.
- Kismet's device monitor websocket would avoid polling entirely, but in
  Kismet 2025.09 its change detection reads a dangling variable and drops
  nearly all updates, so Kestrel does not use it.
- The GPS position comes from Kismet's eventbus (`GPS_LOCATION`) rather than
  polling.  The drive path is a single polyline capped at 20,000 points, which
  fixes the memory leak in the original drive path code.
- Polling pauses while the Map tab or browser window is hidden.
- Kismet's dark theme is respected, including inverted map tiles.

## Development

Everything lives in `plugin-kestrel/httpd/js/kestrel.js` and
`plugin-kestrel/httpd/css/kestrel.css`.  There is no build step; re-run the
install target and reload the browser to pick up changes (Kismet serves the
files from disk, so no restart is needed).

Kismet exposes the plugin module as the global `kestrel` in the browser
console.  `kestrel.getStats()` reports polls, full loads, pushed devices, the
last poll time and the backoff state; `kestrel.getDevices()` and
`kestrel.getDrones()` return the live maps; `kestrel.resyncNow()` forces a
resync; `kestrel.forget(key)` drops a device so the next resync fetches it
back, which is handy for testing.

For test data without radios, replay a pcap through Kismet with a
`pcapfile` source and a `virtual:lat=..,lon=..` GPS; beacons carrying a DJI
DroneID vendor IE exercise the drone tracker.

This was the author's first JavaScript.  Suggestions and pull requests are
very welcome.
