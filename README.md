# Kestrel

Live mapping of located devices, directly inside the Kismet web UI.

![logo](https://github.com/SoliForte/Kestrel/blob/master/Kestrel.png)

Kestrel adds a **Map** tab to the main Kismet pane.  Every device Kismet has a
GPS location for is plotted with a type-specific icon, clustered when zoomed
out, and refreshed live as Kismet sees new devices.  The map filters with the
main device search box, popups link into Kismet's device details window, and
the GPS position and drive path are drawn as Kismet reports them.

Built on [Leaflet](https://leafletjs.com) (shipped with Kismet) and
[PruneCluster](https://github.com/SINTEF-9012/PruneCluster).  Thanks to both
projects, and a huge thanks to Dragorn (@kismetwireless) for making the plugin
system possible and for his help debugging.

[Kestrel in action (original release)](https://www.youtube.com/watch?v=ntG1sJnQLH0)

## Requirements

A current Kismet release.  Kismet now loads web plugins as ES modules and
ships Leaflet itself; Kestrel relies on both.  If you run a Kismet from before
2022, use the previous Kestrel commit (`a6b006b`) instead.

## Installation

Clone this repository:

    git clone https://github.com/soliforte/kestrel
    cd kestrel/plugin-kestrel

Install system-wide (into Kismet's plugin directory, found via pkg-config or
the Kismet source tree in `/usr/src/kismet`):

    sudo make install

Or install for the user who runs Kismet only:

    make userinstall

Restart Kismet, open the web UI, and the **Map** tab appears next to
**Devices**.

## Using it

- **Tile consent.** The first time the map opens it warns that map tiles will
  be fetched from the Internet.  Tick "Don't warn me again" to skip it.
- **Filter.** The box at the top right of the map shows only matching devices
  (case-insensitive; matches name, MAC, type, manufacturer and PHY).  A search
  typed into the Devices tab is carried over to the map filter when you switch
  to the Map tab and the map filter is empty.
- **Popups.** Click a marker for name, MAC, type, manufacturer, signal and
  last-seen time, plus a link to the full device details window.
- **Map controls** (top right): follow the GPS position, show or hide the
  drive path, fit the view to all shown devices, clear the drive path.
  Dragging the map turns off follow mode.
- **Legend** (bottom right) explains the cluster pie colours; the status line
  (bottom left) shows how many devices are plotted and when they last updated.
- The map view is remembered across reloads.

## Settings

Open Kismet's **Settings** and pick **Kestrel Map** to change:

- the tile URL template and attribution, for example to point at a local tile
  server for offline use;
- the maximum zoom level;
- the refresh interval (default 5 seconds);
- whether the drive path is drawn and whether follow mode starts enabled;
- whether the tile warning is shown.

## How it works

- Devices are fetched with Kismet's field simplification, so only the handful
  of fields the map needs cross the wire.  The first load pulls every device;
  later polls ask only for devices active since the previous poll and update
  markers in place, keyed by Kismet's device key.  A full resync once a minute
  picks up anything the incremental polls miss, such as replayed logs with old
  timestamps, and drops devices Kismet has expired.
- The GPS position comes from Kismet's eventbus (`GPS_LOCATION`) rather than
  polling.  The drive path is a single polyline capped at 20,000 points, which
  fixes the memory leak in the original drive path code.
- Polling pauses while the Map tab or browser window is hidden.
- Kismet's dark theme is respected, including inverted map tiles.

## Development

Everything lives in `plugin-kestrel/httpd/js/kestrel.js` and
`plugin-kestrel/httpd/css/kestrel.css`.  There is no build step; `make
userinstall` copies the files and a browser reload picks them up.

This was the author's first JavaScript.  Suggestions and pull requests are
very welcome.
