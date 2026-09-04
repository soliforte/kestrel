/* Kestrel - live device map for the Kismet web UI
 *
 * Author: Soli Forte <soliforte@protonmail.com>
 * https://github.com/soliforte/kestrel
 *
 * Freeware, enjoy.  If you do something really cool with it, let me know.
 * Pull requests encouraged.
 *
 * Kismet loads plugin JS as ES modules (see /dynamic.js).  Kismet's own
 * globals (kismet, kismet_ui, kismet_ui_base, kismet_ui_tabpane,
 * kismet_ui_settings, jQuery) are available to us; Leaflet is shipped by
 * Kismet and loaded on demand below.
 */

"use strict";

// Kismet may be served behind a proxy prefix; every URL we build honors it.
var local_uri_prefix = "";
if (typeof(KISMET_URI_PREFIX) !== 'undefined')
    local_uri_prefix = KISMET_URI_PREFIX;

const PLUGIN_URI = local_uri_prefix + 'plugin/kestrel/';

// ---------------------------------------------------------------------------
// Settings (persisted in the browser via Kismet's storage helpers)
// ---------------------------------------------------------------------------

const DEFAULTS = {
    'kestrel.tiles.url': 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'kestrel.tiles.attribution': '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    'kestrel.tiles.maxzoom': 19,
    'kestrel.poll.interval': 5,
    'kestrel.drivepath.enabled': true,
    'kestrel.follow.enabled': false,
    'kestrel.maps_ok': false,
};

function setting(key) {
    return kismet.getStorage(key, DEFAULTS[key]);
}

// Drive path limits: ignore GPS jitter below this distance, cap total points.
const MIN_PATH_STEP_METERS = 3;
const MAX_PATH_POINTS = 20000;

// Incremental polls only see devices active since the last poll.  A periodic
// full resync catches everything else: devices Kismet expired, records whose
// location arrived late, and log replays whose packets carry old timestamps.
const FULL_RESYNC_SECONDS = 60;

// ---------------------------------------------------------------------------
// Device fields and marker styling
// ---------------------------------------------------------------------------

// Field simplification: ask Kismet for only what we draw, renamed to short keys.
const DEVICE_FIELDS = [
    ['kismet.device.base.key', 'key'],
    ['kismet.device.base.macaddr', 'mac'],
    ['kismet.device.base.commonname', 'name'],
    ['kismet.device.base.type', 'type'],
    ['kismet.device.base.phyname', 'phy'],
    ['kismet.device.base.manuf', 'manuf'],
    ['kismet.device.base.last_time', 'last_time'],
    ['kismet.device.base.signal/kismet.common.signal.last_signal', 'signal'],
    ['kismet.device.base.location/kismet.common.location.avg_loc/kismet.common.location.geopoint', 'geopoint'],
];

// Category index drives the cluster pie chart colours.
const CATEGORIES = [
    { name: 'Wi-Fi AP',     color: '#ff4b00' },
    { name: 'Wi-Fi client', color: '#bac900' },
    { name: 'Other Wi-Fi',  color: '#55bcbe' },
    { name: 'Bluetooth',    color: '#3e647e' },
    { name: 'Other',        color: '#ada59a' },
];

const STYLES = {
    'Wi-Fi AP':         { icon: 'ic_router_black_24dp_1x.png',            category: 0 },
    'Wi-Fi Client':     { icon: 'ic_laptop_chromebook_black_24dp_1x.png', category: 1 },
    'Wi-Fi Bridged':    { icon: 'ic_power_input_black_24dp_1x.png',       category: 2 },
    'Wi-Fi WDS':        { icon: 'ic_leak_add_black_24dp_1x.png',          category: 2 },
    'Wi-Fi WDS AP':     { icon: 'ic_leak_add_black_24dp_1x.png',          category: 2 },
    'Wi-Fi WDS Device': { icon: 'ic_leak_add_black_24dp_1x.png',          category: 2 },
    'Wi-Fi Ad-Hoc':     { icon: 'ic_cast_connected_black_24dp_1x.png',    category: 2 },
    'Wi-Fi Device':     { icon: 'ic_network_check_black_24dp_1x.png',     category: 2 },
};
const BLUETOOTH_STYLE = { icon: 'ic_bluetooth_black_24dp_1x.png',     category: 3 };
const DEFAULT_STYLE   = { icon: 'ic_network_check_black_24dp_1x.png', category: 4 };

function styleFor(rec) {
    if (rec.type in STYLES)
        return STYLES[rec.type];
    if (rec.phy === 'Bluetooth' || rec.phy === 'BTLE')
        return BLUETOOTH_STYLE;
    return DEFAULT_STYLE;
}

const iconCache = {};
function leafletIcon(file) {
    if (!(file in iconCache)) {
        iconCache[file] = L.icon({
            iconUrl: PLUGIN_URI + 'images/' + file,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
            className: 'kestrel-device-icon',
        });
    }
    return iconCache[file];
}

// ---------------------------------------------------------------------------
// Stylesheets and script loading
// ---------------------------------------------------------------------------

for (const href of [local_uri_prefix + 'css/leaflet.css', PLUGIN_URI + 'css/kestrel.css']) {
    $('<link>')
        .attr({ type: 'text/css', rel: 'stylesheet', href: href })
        .appendTo('head');
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('failed to load ' + src));
        document.head.appendChild(s);
    });
}

// Kismet's own UI usually injects js/leaflet.js already (the ADSB view uses
// it), so wait for the global rather than loading a second copy.
function ensureLeaflet() {
    if (typeof L !== 'undefined')
        return Promise.resolve();

    return new Promise((resolve, reject) => {
        if (document.querySelector('script[src$="js/leaflet.js"]') == null) {
            loadScript(local_uri_prefix + 'js/leaflet.js').catch(reject);
        }

        const started = Date.now();
        const tick = () => {
            if (typeof L !== 'undefined')
                return resolve();
            if (Date.now() - started > 15000)
                return reject(new Error('timed out waiting for Leaflet'));
            setTimeout(tick, 50);
        };
        tick();
    });
}

const pluginReady = ensureLeaflet().then(() => loadScript(PLUGIN_URI + 'js/PruneCluster.js'));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let map = null;
let tileLayer = null;
let cluster = null;
let drivePath = null;
let positionMarker = null;
let statusControl = null;

// device key -> { key, mac, name, type, phy, manuf, signal, last_time, lat, lon, marker }
const devices = new Map();

let pollTimer = null;
let lastFullLoad = 0;
let viewInitialized = false;
let lastUpdate = null;
let lastPathPoint = null;
let follow = false;
let appliedSearchTerm = '';

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

kismet_ui_tabpane.AddTab({
    id: 'kestrel_map_tab',
    tabTitle: 'Map',
    expandable: false,
    priority: -50,
    createCallback: function(div) {
        div.ready(() => buildContent(div));
    },
    activateCallback: function() {
        if (map != null) {
            // The tab was hidden while we set up; Leaflet needs to re-measure.
            setTimeout(() => {
                map.invalidateSize();
                if (!viewInitialized)
                    fitDevices();
            }, 50);

            // Carry the Devices tab search over to the map filter when the
            // map's own box is empty, so a search started there keeps working.
            const box = $('#kestrel_filter');
            const devicesTerm = String(kismet.getStorage('kismet.ui.deviceview.search', '') || '');
            if (box.val() === '' && devicesTerm !== '')
                box.val(devicesTerm);
            applyFilter();
        }
        schedulePoll(0);
    },
}, 'center');

function buildContent(div) {
    div.html(`
    <div id="kestrel_holder">
        <div id="kestrel_warning" class="kestrel-warning">
            <p><b>Kestrel map</b></p>
            <p>To draw the map, your browser will fetch map tiles from the configured
            tile server (OpenStreetMap by default).  This requires an Internet connection
            and reveals the general area you are viewing to that server.  The tile server
            can be changed in Settings &rarr; Kestrel Map.</p>
            <p><input id="kestrel_dontwarn" type="checkbox">
               <label for="kestrel_dontwarn">Don't warn me again</label></p>
            <p><button id="kestrel_continue">Continue</button></p>
        </div>
        <div id="kestrel_map"></div>
    </div>`);

    $('#kestrel_continue', div).on('click', () => {
        if ($('#kestrel_dontwarn', div).is(':checked'))
            kismet.putStorage('kestrel.maps_ok', true);
        $('#kestrel_warning', div).hide();
        startMap();
    });

    if (setting('kestrel.maps_ok')) {
        $('#kestrel_warning', div).hide();
        startMap();
    }
}

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------

function makeTileLayer() {
    return L.tileLayer(setting('kestrel.tiles.url'), {
        maxZoom: Number(setting('kestrel.tiles.maxzoom')) || DEFAULTS['kestrel.tiles.maxzoom'],
        attribution: setting('kestrel.tiles.attribution'),
        className: 'map-tiles',
    });
}

async function startMap() {
    if (map != null)
        return;

    try {
        await pluginReady;
    } catch (e) {
        $('#kestrel_map').text('Kestrel could not load its map libraries: ' + e.message);
        return;
    }

    defineClusterIcon();

    map = L.map('kestrel_map');
    if (!restoreView())
        map.setView([20, 0], 2);

    tileLayer = makeTileLayer().addTo(map);

    cluster = new PruneClusterForLeaflet();
    cluster.BuildLeafletClusterIcon = function(c) {
        const icon = new L.Icon.MarkerCluster();
        icon.stats = c.stats;
        icon.population = c.population;
        return icon;
    };
    map.addLayer(cluster);

    drivePath = L.polyline([], { color: '#1e88e5', weight: 3, opacity: 0.8 });
    if (setting('kestrel.drivepath.enabled'))
        drivePath.addTo(map);

    positionMarker = L.circleMarker([0, 0], {
        radius: 7, color: '#ffffff', weight: 2, fillColor: '#1e88e5', fillOpacity: 1,
    });

    follow = setting('kestrel.follow.enabled');

    addControls();

    map.on('moveend', saveView);
    map.on('dragstart', () => setFollow(false));

    // Popups carry a link into Kismet's own device details window.
    $('#kestrel_map').on('click', '.kestrel-detail', (e) => {
        e.preventDefault();
        kismet_ui.DeviceDetailWindow($(e.currentTarget).attr('data-key'));
    });

    // Keep the map sized to the pane when Kismet's layout changes.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('kestrel_holder'));
    }

    kismet_ui_base.SubscribeEventbus('GPS_LOCATION', [], onGpsLocation);

    schedulePoll(0);
}

function defineClusterIcon() {
    if (L.Icon.MarkerCluster)
        return;

    // Canvas pie chart of device categories, with the population in the middle.
    L.Icon.MarkerCluster = L.Icon.extend({
        options: {
            iconSize: new L.Point(44, 44),
            className: 'prunecluster leaflet-markercluster-icon',
        },
        createIcon: function() {
            const canvas = document.createElement('canvas');
            this._setIconStyles(canvas, 'icon');
            canvas.width = 44;
            canvas.height = 44;
            this.draw(canvas.getContext('2d'));
            return canvas;
        },
        createShadow: function() {
            return null;
        },
        draw: function(ctx) {
            const c = 22, r = 22, pi2 = Math.PI * 2;
            let start = 0;

            for (let i = 0; i < CATEGORIES.length; i++) {
                const share = (this.stats[i] || 0) / this.population;
                if (share <= 0)
                    continue;
                const end = start + share * pi2;
                ctx.beginPath();
                ctx.moveTo(c, c);
                ctx.fillStyle = CATEGORIES[i].color;
                ctx.arc(c, c, r, start, end);
                ctx.lineTo(c, c);
                ctx.fill();
                start = end;
            }

            ctx.beginPath();
            ctx.fillStyle = 'white';
            ctx.arc(c, c, 16, 0, pi2);
            ctx.fill();

            ctx.fillStyle = '#333';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(String(this.population), c, c, 30);
        },
    });
}

function addControls() {
    const options = L.control({ position: 'topright' });
    options.onAdd = function() {
        const div = L.DomUtil.create('div', 'kestrel-control leaflet-bar');
        div.innerHTML = `
            <input type="search" id="kestrel_filter" placeholder="Filter devices...">
            <label><input type="checkbox" id="kestrel_follow"> Follow GPS</label>
            <label><input type="checkbox" id="kestrel_showpath"> Drive path</label>
            <button type="button" id="kestrel_fit">Fit to devices</button>
            <button type="button" id="kestrel_clearpath">Clear path</button>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
    };
    options.addTo(map);

    $('#kestrel_filter').on('input change search', $.debounce(250, () => applyFilter()));
    $('#kestrel_follow').prop('checked', follow)
        .on('change', (e) => setFollow(e.target.checked));
    $('#kestrel_showpath').prop('checked', setting('kestrel.drivepath.enabled'))
        .on('change', (e) => showDrivePath(e.target.checked));
    $('#kestrel_fit').on('click', () => fitDevices());
    $('#kestrel_clearpath').on('click', () => clearDrivePath());

    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'kestrel-legend');
        div.innerHTML = CATEGORIES.map((c) =>
            `<span><i class="swatch" style="background:${c.color}"></i>${c.name}</span>`).join('');
        return div;
    };
    legend.addTo(map);

    statusControl = L.control({ position: 'bottomleft' });
    statusControl.onAdd = function() {
        return L.DomUtil.create('div', 'kestrel-status');
    };
    statusControl.addTo(map);
    updateStatus();
}

function setFollow(enabled) {
    follow = enabled;
    $('#kestrel_follow').prop('checked', enabled);
    if (enabled && lastPathPoint != null)
        map.panTo(lastPathPoint);
}

function showDrivePath(enabled) {
    $('#kestrel_showpath').prop('checked', enabled);
    if (enabled && !map.hasLayer(drivePath))
        drivePath.addTo(map);
    else if (!enabled && map.hasLayer(drivePath))
        drivePath.remove();
}

function clearDrivePath() {
    drivePath.setLatLngs([]);
    lastPathPoint = null;
}

function saveView() {
    const c = map.getCenter();
    kismet.putStorage('kestrel.view', { lat: c.lat, lon: c.lng, zoom: map.getZoom() });
}

function restoreView() {
    const v = kismet.getStorage('kestrel.view', null);
    if (v == null || typeof v !== 'object')
        return false;
    map.setView([v.lat, v.lon], v.zoom);
    viewInitialized = true;
    return true;
}

function fitDevices() {
    const points = [];
    for (const rec of devices.values()) {
        if (!rec.marker.filtered)
            points.push([rec.lat, rec.lon]);
    }
    if (points.length === 0)
        return;
    map.fitBounds(L.latLngBounds(points), { padding: [20, 20], maxZoom: 17 });
    viewInitialized = true;
}

function updateStatus() {
    if (statusControl == null)
        return;
    let shown = 0;
    for (const rec of devices.values()) {
        if (!rec.marker.filtered)
            shown++;
    }
    const when = lastUpdate == null ? 'never' : lastUpdate.toLocaleTimeString();
    $(statusControl.getContainer()).text(`${shown} of ${devices.size} located devices shown; updated ${when}`);
}

// ---------------------------------------------------------------------------
// Device polling
// ---------------------------------------------------------------------------

function fetchDevices(sinceSeconds) {
    // A full load pulls every device Kismet knows; incremental polls only ask
    // for devices active since the previous poll.
    const url = sinceSeconds == null
        ? `${local_uri_prefix}devices/views/all/devices.json`
        : `${local_uri_prefix}devices/views/all/last-time/${-sinceSeconds}/devices.json`;

    return $.post(url, { json: JSON.stringify({ fields: DEVICE_FIELDS }) });
}

function hasLocation(d) {
    // Devices without a location come back with the geopoint simplified to 0.
    return Array.isArray(d.geopoint) && d.geopoint.length === 2 &&
        !(d.geopoint[0] === 0 && d.geopoint[1] === 0);
}

// Merge a batch of device records into the marker set.  Returns true when a
// marker was added, moved or removed and the cluster view needs reprocessing.
// A full batch is authoritative: devices missing from it are dropped.
function ingest(list, full) {
    let changed = false;
    const seen = full ? new Set() : null;

    for (const d of list) {
        if (seen != null)
            seen.add(d.key);

        if (!hasLocation(d))
            continue;

        const lat = d.geopoint[1];
        const lon = d.geopoint[0];

        let rec = devices.get(d.key);
        if (rec == null) {
            rec = { key: d.key, lat: lat, lon: lon, marker: new PruneCluster.Marker(lat, lon) };
            rec.marker.data.rec = rec;
            rec.marker.data.popup = popupFor;
            devices.set(d.key, rec);
            cluster.RegisterMarker(rec.marker);
            changed = true;
        } else if (rec.lat !== lat || rec.lon !== lon) {
            rec.marker.Move(lat, lon);
            rec.lat = lat;
            rec.lon = lon;
            changed = true;
        }

        rec.mac = d.mac;
        rec.name = d.name;
        rec.type = d.type;
        rec.phy = d.phy;
        rec.manuf = d.manuf;
        rec.signal = d.signal;
        rec.last_time = d.last_time;

        const style = styleFor(rec);
        if (rec.marker.category !== style.category)
            changed = true;
        rec.marker.category = style.category;
        rec.marker.data.icon = leafletIcon(style.icon);
    }

    if (seen != null) {
        const stale = [];
        for (const [key, rec] of devices) {
            if (!seen.has(key)) {
                stale.push(rec.marker);
                devices.delete(key);
            }
        }
        if (stale.length > 0) {
            cluster.RemoveMarkers(stale);
            changed = true;
        }
    }

    return changed;
}

function popupFor(data) {
    // Strings were escaped by kismet.sanitizeObject when they arrived.
    const r = data.rec;
    const seen = r.last_time ? new Date(r.last_time * 1000).toLocaleString() : 'unknown';
    const signal = r.signal ? `${r.signal} dBm` : 'unknown';
    return `<div class="kestrel-popup">
        <b>${r.name || '(unnamed)'}</b><br>
        MAC: ${kismet.censorMAC(r.mac)}<br>
        Type: ${r.type} (${r.phy})<br>
        Manufacturer: ${r.manuf}<br>
        Signal: ${signal}<br>
        Last seen: ${seen}<br>
        <a href="#" class="kestrel-detail" data-key="${r.key}">Device details</a>
    </div>`;
}

function currentSearchTerm() {
    return String($('#kestrel_filter').val() || '').trim().toLowerCase();
}

function matchesSearch(rec, term) {
    if (term === '')
        return true;
    return [rec.name, rec.mac, rec.type, rec.manuf, rec.phy]
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(term));
}

function applyFilter() {
    if (cluster == null)
        return;
    const term = currentSearchTerm();
    for (const rec of devices.values())
        rec.marker.filtered = !matchesSearch(rec, term);
    appliedSearchTerm = term;
    cluster.ProcessView();
    updateStatus();
}

function schedulePoll(delayMs) {
    if (pollTimer != null)
        clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, delayMs);
}

function pollOnce() {
    pollTimer = null;

    // Don't hammer the server while the tab or window is hidden.
    if (map == null || !kismet_ui.window_visible || !$('#kestrel_map').is(':visible')) {
        schedulePoll(1000);
        return;
    }

    const interval = Math.max(1, Number(setting('kestrel.poll.interval')) || DEFAULTS['kestrel.poll.interval']);
    const full = (Date.now() - lastFullLoad) > FULL_RESYNC_SECONDS * 1000;
    const since = full ? null : interval * 2 + 1;
    const firstBatch = devices.size === 0;

    fetchDevices(since)
        .done((data) => {
            const list = kismet.sanitizeObject(Array.isArray(data) ? data : []);
            const changed = ingest(list, full);
            if (full)
                lastFullLoad = Date.now();
            lastUpdate = new Date();

            if (changed || currentSearchTerm() !== appliedSearchTerm)
                applyFilter();
            else
                updateStatus();

            if (firstBatch && devices.size > 0 && !viewInitialized)
                fitDevices();
        })
        .fail((xhr) => {
            console.warn('kestrel: device fetch failed', xhr.status, xhr.statusText);
        })
        .always(() => schedulePoll(interval * 1000));
}

// ---------------------------------------------------------------------------
// GPS drive path (pushed by the server once per second over the eventbus)
// ---------------------------------------------------------------------------

function onGpsLocation(loc) {
    if (map == null || loc == null)
        return;

    const gp = loc['kismet.common.location.geopoint'];
    const fix = loc['kismet.common.location.fix'];

    if (!Array.isArray(gp) || fix < 2 || (gp[0] === 0 && gp[1] === 0))
        return;

    const point = [gp[1], gp[0]];

    positionMarker.setLatLng(point);
    if (!map.hasLayer(positionMarker))
        positionMarker.addTo(map);

    if (lastPathPoint == null || map.distance(lastPathPoint, point) >= MIN_PATH_STEP_METERS) {
        drivePath.addLatLng(point);
        lastPathPoint = point;

        // One polyline, bounded in length: this is what leaked memory before.
        const pts = drivePath.getLatLngs();
        if (pts.length > MAX_PATH_POINTS)
            drivePath.setLatLngs(pts.slice(pts.length - MAX_PATH_POINTS));
    }

    if (!viewInitialized) {
        map.setView(point, 16);
        viewInitialized = true;
    } else if (follow) {
        map.panTo(point);
    }
}

// ---------------------------------------------------------------------------
// Settings pane
// ---------------------------------------------------------------------------

kismet_ui_settings.AddSettingsPane({
    id: 'kestrel_settings',
    listTitle: 'Kestrel Map',
    create: (elem) => {
        elem.append(`
        <form>
        <fieldset id="kestrel_fs">
            <legend>Kestrel Map</legend>
            <div><label for="kestrel_s_tiles">Tile URL template</label><br>
                 <input type="text" id="kestrel_s_tiles" size="60"></div>
            <p>A Leaflet tile URL template using {s}, {z}, {x} and {y}.  The default is
               OpenStreetMap; point this at a local tile server for offline use.</p>
            <div><label for="kestrel_s_attr">Tile attribution (HTML)</label><br>
                 <input type="text" id="kestrel_s_attr" size="60"></div>
            <div><label for="kestrel_s_maxzoom">Maximum zoom level</label>
                 <input type="number" id="kestrel_s_maxzoom" min="1" max="22"></div>
            <div><label for="kestrel_s_interval">Refresh interval (seconds)</label>
                 <input type="number" id="kestrel_s_interval" min="1" max="600"></div>
            <div><input type="checkbox" id="kestrel_s_path">
                 <label for="kestrel_s_path">Draw the drive path from GPS</label></div>
            <div><input type="checkbox" id="kestrel_s_follow">
                 <label for="kestrel_s_follow">Follow the GPS position by default</label></div>
            <div><input type="checkbox" id="kestrel_s_warn">
                 <label for="kestrel_s_warn">Warn before fetching map tiles</label></div>
        </fieldset>
        </form>`);

        $('#kestrel_s_tiles', elem).val(setting('kestrel.tiles.url'));
        $('#kestrel_s_attr', elem).val(setting('kestrel.tiles.attribution'));
        $('#kestrel_s_maxzoom', elem).val(setting('kestrel.tiles.maxzoom'));
        $('#kestrel_s_interval', elem).val(setting('kestrel.poll.interval'));
        $('#kestrel_s_path', elem).prop('checked', setting('kestrel.drivepath.enabled'));
        $('#kestrel_s_follow', elem).prop('checked', setting('kestrel.follow.enabled'));
        $('#kestrel_s_warn', elem).prop('checked', !setting('kestrel.maps_ok'));

        $('form', elem).on('change input', () => kismet_ui_settings.SettingsModified());
    },
    save: (elem) => {
        const url = $('#kestrel_s_tiles', elem).val().trim();
        kismet.putStorage('kestrel.tiles.url', url !== '' ? url : DEFAULTS['kestrel.tiles.url']);
        kismet.putStorage('kestrel.tiles.attribution', $('#kestrel_s_attr', elem).val());
        kismet.putStorage('kestrel.tiles.maxzoom',
            Number($('#kestrel_s_maxzoom', elem).val()) || DEFAULTS['kestrel.tiles.maxzoom']);
        kismet.putStorage('kestrel.poll.interval',
            Number($('#kestrel_s_interval', elem).val()) || DEFAULTS['kestrel.poll.interval']);
        kismet.putStorage('kestrel.drivepath.enabled', $('#kestrel_s_path', elem).is(':checked'));
        kismet.putStorage('kestrel.follow.enabled', $('#kestrel_s_follow', elem).is(':checked'));
        kismet.putStorage('kestrel.maps_ok', !$('#kestrel_s_warn', elem).is(':checked'));

        applySettings();
    },
});

function applySettings() {
    if (map == null)
        return;

    // Recreating the tile layer picks up the URL, zoom and attribution together.
    tileLayer.remove();
    tileLayer = makeTileLayer().addTo(map);

    showDrivePath(setting('kestrel.drivepath.enabled'));
    setFollow(setting('kestrel.follow.enabled'));
}

// Handy from the browser console: kestrel.getDevices()
export function getDevices() {
    return devices;
}
