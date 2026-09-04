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
    'kestrel.poll.interval': 2,
    'kestrel.drivepath.enabled': true,
    'kestrel.follow.enabled': false,
    'kestrel.drones.enabled': true,
    'kestrel.drones.jump': true,
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

// Polling adapts to the server: when a request takes longer than half the
// configured interval the effective interval doubles, up to this cap, and
// decays back once responses are quick again.  Kismet's own device table
// polls every second, so the configured rate is not unusual load; this
// protects a small server or a slow link from a pile-up.
const MAX_BACKOFF_SECONDS = 30;

// Kismet's device monitor websocket would be the ideal feed, but in 2025.09
// its change detection compares against a dangling stack variable and drops
// nearly all updates, so new devices come from the eventbus and everything
// else from polling.

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
    ['kismet.device.base.crypt', 'crypt'],
    ['kismet.device.base.frequency', 'freq'],
    ['kismet.device.base.channel', 'chan'],
    ['dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.ht_mode', 'ht'],
    // Only populated when kismet.conf has dot11_keep_ietags=true.
    ['dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.ie_tag_list', 'ietags'],
    // UAV records from Kismet's drone PHY (DJI DroneID over Wi-Fi or RF).
    // Only the position and serial come from Wi-Fi DroneID; the rest is
    // filled in by RF capture (ANTSDR) and stays 0 otherwise.
    ['uav.device/uav.manufacturer', 'uav_manuf'],
    ['uav.device/uav.model', 'uav_model'],
    ['uav.device/uav.serialnumber', 'uav_serial'],
    ['uav.device/uav.match_type', 'uav_match'],
    ['uav.device/uav.last_telemetry/uav.telemetry.location/kismet.common.location.geopoint', 'uav_pos'],
    ['uav.device/uav.last_telemetry/uav.telemetry.location/kismet.common.location.alt', 'uav_alt'],
    ['uav.device/uav.last_telemetry/uav.telemetry.location/kismet.common.location.fix', 'uav_fix'],
    ['uav.device/uav.last_telemetry/uav.telemetry.height', 'uav_height'],
    ['uav.device/uav.last_telemetry/uav.telemetry.yaw', 'uav_yaw'],
    ['uav.device/uav.last_telemetry/uav.telemetry.v_north', 'uav_vn'],
    ['uav.device/uav.last_telemetry/uav.telemetry.v_east', 'uav_ve'],
    ['uav.device/uav.last_telemetry/uav.telemetry.v_up', 'uav_vu'],
    ['uav.device/uav.last_telemetry/uav.telemetry.airborne', 'uav_airborne'],
    ['uav.device/uav.last_telemetry/uav.telemetry.motor_on', 'uav_motor'],
    ['uav.device/uav.telemetry.home_location/kismet.common.location.geopoint', 'uav_home'],
    ['uav.device/uav.telemetry.app_location/kismet.common.location.geopoint', 'uav_operator'],
    ['uav.device/uav.telemetry_history', 'uav_history'],
];

// ---------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------

// Drones are drawn where they say they are (their broadcast telemetry), not
// where Kismet heard them, so they live outside the device cluster.
const DRONE_COLORS = ['#ff1744', '#00e5ff', '#ffea00', '#76ff03', '#ff9100', '#e040fb'];
const DRONE_STALE_SECONDS = 60;
const DRONE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/>' +
    '<circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>' +
    '<path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/>' +
    '<rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/></svg>';

function hasPoint(gp) {
    return Array.isArray(gp) && gp.length === 2 && !(gp[0] === 0 && gp[1] === 0);
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// A marker is a coloured disc: the fill is the security class (also the
// cluster pie category), the ring is the frequency band, the glyph is the
// device type, and a badge carries the Wi-Fi generation when it is known.

// Index doubles as the PruneCluster category, so order matters.
const SECURITY = [
    { key: 'open',    name: 'Open',    color: '#e53935' },
    { key: 'wep',     name: 'WEP',     color: '#fb8c00' },
    { key: 'wpa',     name: 'WPA',     color: '#fdd835' },
    { key: 'wpa2',    name: 'WPA2',    color: '#7cb342' },
    { key: 'wpa3',    name: 'WPA3',    color: '#00897b' },
    { key: 'unknown', name: 'Unknown', color: '#78909c' },
];

const BANDS = {
    '2.4': { name: '2.4 GHz', color: '#ffb300' },
    '5':   { name: '5 GHz',   color: '#42a5f5' },
    '6':   { name: '6 GHz',   color: '#ab47bc' },
};
// Object.values() would put the integer-like keys first; keep display order.
const BAND_ORDER = ['2.4', '5', '6'];

// Font Awesome 6 glyphs, shipped with Kismet.  Bluetooth uses Kismet's own
// SVG because the Bluetooth glyph is not in the free solid set.
const GLYPHS = {
    'Wi-Fi AP':         'fa-wifi',
    'Wi-Fi Client':     'fa-laptop',
    'Wi-Fi Bridged':    'fa-ethernet',
    'Wi-Fi WDS':        'fa-diagram-project',
    'Wi-Fi WDS AP':     'fa-diagram-project',
    'Wi-Fi WDS Device': 'fa-diagram-project',
    'Wi-Fi Ad-Hoc':     'fa-circle-nodes',
    'Wi-Fi Device':     'fa-signal',
};

const ENTERPRISE_RE = /-(EAP|PEAP|LEAP|TTLS|TLS)\b/;

// Kismet's crypt string looks like "WPA2 WPA2-PSK AES-CCMP" or "Open".  It is
// empty for clients and anything Kismet never saw an RSN IE from.
function securityFor(crypt) {
    if (crypt.includes('WPA3'))
        return 4;
    if (crypt.includes('WPA2'))
        return 3;
    if (crypt.includes('WPA'))
        return 2;
    if (crypt.includes('WEP'))
        return 1;
    if (crypt.startsWith('Open'))
        return 0;
    return 5;
}

// "WPA2 WPA2-PSK AES-CCMP" -> "WPA2-PSK (AES-CCMP)"
function securityLabel(rec) {
    if (rec.crypt === '')
        return SECURITY[rec.security].name;
    const parts = rec.crypt.split(' ');
    const akm = parts.filter((p) => /-(PSK|SAE|EAP|PEAP|LEAP|TTLS|TLS|FILS|TDLS)/.test(p));
    const ciphers = parts.filter((p) => /^(AES|TKIP|WEP)/.test(p));
    let label = akm.length ? akm.join(' / ') : parts[0];
    if (ciphers.length)
        label += ` (${ciphers.join(', ')})`;
    return label;
}

function bandFor(freqKhz) {
    const mhz = freqKhz / 1000;
    if (mhz >= 2400 && mhz < 2500)
        return '2.4';
    if (mhz >= 5150 && mhz < 5925)
        return '5';
    if (mhz >= 5925 && mhz <= 7125)
        return '6';
    return null;
}

// Kismet does not decode 802.11ax/be capabilities, so the generation is
// inferred.  With dot11_keep_ietags=true the beacon's IE tag list is exact
// up to Wi-Fi 6 (HE and EHT both hide behind extension tag 255); otherwise
// the channel width and band give a lower bound.  A trailing "+" means
// "at least".  Returns null when nothing can be said, 'legacy' for a/b/g.
function generationFor(rec) {
    if (!/^Wi-Fi (AP|Ad-Hoc|WDS)/.test(rec.type))
        return null;

    if (rec.ietags != null && rec.ietags.length > 0) {
        if (rec.ietags.includes(255))
            return '6+';
        if (rec.ietags.includes(191))
            return '5';
        if (rec.ietags.includes(45))
            return '4';
        return 'legacy';
    }

    if (rec.band === '6')
        return '6+';
    if (/HT(80|160)/.test(rec.ht))
        return '5+';
    if (/HT(20|40)/.test(rec.ht))
        return '4+';
    return null;
}

function generationLabel(rec) {
    if (rec.gen === 'legacy')
        return 'Legacy (802.11a/b/g)';
    if (rec.gen != null)
        return `Wi-Fi ${rec.gen}` + (rec.ht ? ` (${rec.ht})` : '');
    return rec.ht;
}

// Icons are shared between devices with the same look, so nothing
// device-specific may go into the HTML.
const iconCache = new Map();
function markerIcon(rec) {
    const sec = SECURITY[rec.security];
    const band = rec.band != null ? BANDS[rec.band] : null;
    const isBluetooth = rec.phy === 'Bluetooth' || rec.phy === 'BTLE';
    const glyph = rec.uav != null ? 'drone' : (GLYPHS[rec.type] || (isBluetooth ? 'bluetooth' : 'fa-microchip'));
    const badge = rec.gen != null && rec.gen !== 'legacy' ? rec.gen : '';
    const key = [sec.key, rec.band, glyph, badge, rec.enterprise].join('|');

    let icon = iconCache.get(key);
    if (icon == null) {
        let inner;
        if (glyph === 'bluetooth')
            inner = `<img src="${local_uri_prefix}images/bluetooth-solid-icon-dark.svg" alt="">`;
        else if (glyph === 'drone')
            inner = DRONE_SVG;
        else
            inner = `<i class="fa ${glyph}"></i>`;
        const html =
            `<div class="kestrel-marker" style="--fill:${sec.color};--ring:${band ? band.color : '#ffffff'}">` +
            inner +
            (badge ? `<span class="kestrel-badge">${badge}</span>` : '') +
            (rec.enterprise ? '<i class="fa fa-lock kestrel-lock"></i>' : '') +
            '</div>';
        icon = L.divIcon({
            className: 'kestrel-divicon',
            html: html,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -14],
        });
        iconCache.set(key, icon);
    }
    return icon;
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

// device key -> { key, color, pos, marker, track, home, operator, link, group, ... }
const drones = new Map();
let droneLayer = null;
let droneColorNext = 0;

let pollTimer = null;
let pollInFlight = false;
let lastFullLoad = 0;
let backoffFactor = 1;
let effectiveInterval = 0;
const stats = { polls: 0, fullLoads: 0, pushed: 0, lastPollMs: 0 };
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

    droneLayer = L.layerGroup();
    if (setting('kestrel.drones.enabled'))
        droneLayer.addTo(map);

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

    // New devices arrive the moment Kismet creates them, ahead of the poll.
    kismet_ui_base.SubscribeEventbus('NEW_DEVICE', DEVICE_FIELDS, onNewDevice);

    schedulePoll(0);
}

// The eventbus applies one field list per topic per connection, so if another
// module subscribes to NEW_DEVICE the record may arrive in full rather than in
// our simplified shape.  Accept both.
function normalizeRecord(d) {
    if ('key' in d)
        return d;
    const out = {};
    for (const [path, alias] of DEVICE_FIELDS) {
        const v = kismet.ObjectByString(d, path);
        out[alias] = v === undefined ? 0 : v;
    }
    return out;
}

function onNewDevice(d) {
    if (map == null || d == null || typeof d !== 'object')
        return;
    stats.pushed++;
    const list = kismet.sanitizeObject([normalizeRecord(d)]);
    if (ingest(list, false))
        applyFilter();
}

function defineClusterIcon() {
    if (L.Icon.MarkerCluster)
        return;

    // Canvas pie chart of security classes, with the population in the middle.
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

            for (let i = 0; i < SECURITY.length; i++) {
                const share = (this.stats[i] || 0) / this.population;
                if (share <= 0)
                    continue;
                const end = start + share * pi2;
                ctx.beginPath();
                ctx.moveTo(c, c);
                ctx.fillStyle = SECURITY[i].color;
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
            <label><input type="checkbox" id="kestrel_showdrones"> Drones</label>
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
    $('#kestrel_showdrones').prop('checked', setting('kestrel.drones.enabled'))
        .on('change', (e) => showDrones(e.target.checked));
    $('#kestrel_fit').on('click', () => fitDevices());
    $('#kestrel_clearpath').on('click', () => clearDrivePath());

    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'kestrel-legend');
        const security = SECURITY.map((s) =>
            `<span><i class="swatch" style="background:${s.color}"></i>${s.name}</span>`).join('');
        const bands = BAND_ORDER.map((k) => BANDS[k]).map((b) =>
            `<span><i class="swatch ring" style="border-color:${b.color}"></i>${b.name}</span>`).join('');
        div.innerHTML =
            `<div><b>Security</b> ${security}</div>` +
            `<div><b>Band</b> ${bands} <span><span class="kestrel-badge">5+</span> Wi-Fi generation, + = at least</span>` +
            ` <span><i class="kestrel-legend-drone">${DRONE_SVG}</i>drone at its broadcast position</span></div>`;
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

function showDrones(enabled) {
    $('#kestrel_showdrones').prop('checked', enabled);
    if (enabled && !map.hasLayer(droneLayer))
        droneLayer.addTo(map);
    else if (!enabled && map.hasLayer(droneLayer))
        droneLayer.remove();
    updateStatus();
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
    if (map.hasLayer(droneLayer)) {
        for (const dr of drones.values()) {
            if (dr.shown)
                points.push(dr.pos);
        }
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
    let text = `${shown} of ${devices.size} located devices shown`;

    if (drones.size > 0) {
        let live = 0;
        for (const dr of drones.values()) {
            refreshDroneIcon(dr);
            if (dr.shown && !dr.stale)
                live++;
        }
        text += `; ${drones.size} drone${drones.size === 1 ? '' : 's'}`;
        if (live !== drones.size)
            text += ` (${live} live)`;
        if (!map.hasLayer(droneLayer))
            text += ' hidden';
    }

    if (backoffFactor > 1)
        text += `; server slow, polling every ${effectiveInterval}s`;

    $(statusControl.getContainer()).text(`${text}; updated ${when}`);
}

// ---------------------------------------------------------------------------
// Drone tracking
// ---------------------------------------------------------------------------

function droneIcon(dr) {
    const heading = Math.round(dr.yaw * 180 / Math.PI);
    return L.divIcon({
        className: 'kestrel-divicon',
        html: `<div class="kestrel-drone${dr.stale ? ' stale' : ''}" style="--c:${dr.color};transform:rotate(${heading}deg)">` +
              `<span class="kestrel-drone-nose"></span>${DRONE_SVG}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18],
    });
}

function auxIcon(dr, glyph) {
    return L.divIcon({
        className: 'kestrel-divicon',
        html: `<div class="kestrel-drone-aux" style="--c:${dr.color}"><i class="fa ${glyph}"></i></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
    });
}

function refreshDroneIcon(dr) {
    const stale = (Date.now() / 1000 - dr.last_time) > DRONE_STALE_SECONDS;
    const heading = Math.round(dr.yaw * 180 / Math.PI);
    if (stale !== dr.stale || heading !== dr.drawnHeading) {
        dr.stale = stale;
        dr.drawnHeading = heading;
        dr.marker.setIcon(droneIcon(dr));
    }
}

// Returns true when the drone is new to the map.
function updateDrone(d) {
    // Kismet keeps the last 128 telemetry points per drone; that is the track.
    // Its packet chain is multi-threaded, so sort by telemetry timestamp
    // rather than trusting the vector order, and take the newest point as
    // the drone's position rather than Kismet's "last telemetry".
    const points = [];
    if (Array.isArray(d.uav_history)) {
        const entries = d.uav_history
            .map((entry) => ({
                ts: num(entry['uav.telemetry.timestamp']),
                gp: kismet.ObjectByString(entry, 'uav.telemetry.location/kismet.common.location.geopoint'),
            }))
            .filter((e) => hasPoint(e.gp))
            .sort((a, b) => a.ts - b.ts);
        for (const e of entries)
            points.push([e.gp[1], e.gp[0]]);
    }
    if (points.length === 0)
        points.push([d.uav_pos[1], d.uav_pos[0]]);
    const pos = points[points.length - 1];

    let dr = drones.get(d.key);
    const isNew = dr == null;

    if (isNew) {
        const color = DRONE_COLORS[droneColorNext++ % DRONE_COLORS.length];
        dr = {
            key: d.key,
            color: color,
            stale: false,
            drawnHeading: null,
            shown: true,
            yaw: 0,
            group: L.layerGroup(),
            track: L.polyline([], { color: color, weight: 2.5, opacity: 0.85 }),
            marker: null,
            home: null,
            operator: null,
            link: null,
        };
        // Give the marker its icon up front, or Leaflet fetches its default
        // marker images, which Kismet does not serve.
        dr.marker = L.marker(pos, { icon: droneIcon(dr), zIndexOffset: 1000 });
        dr.marker.bindPopup(() => dronePopup(dr), { minWidth: 220 });
        dr.group.addLayer(dr.track).addLayer(dr.marker);
        droneLayer.addLayer(dr.group);
        drones.set(d.key, dr);
    }

    dr.name = d.name;
    dr.mac = d.mac;
    dr.manuf = typeof d.uav_manuf === 'string' && d.uav_manuf !== '' ? d.uav_manuf : d.manuf;
    dr.model = typeof d.uav_model === 'string' ? d.uav_model : '';
    dr.serial = typeof d.uav_serial === 'string' ? d.uav_serial : '';
    dr.match = typeof d.uav_match === 'string' ? d.uav_match : '';
    dr.last_time = num(d.last_time);
    dr.pos = pos;
    dr.alt = num(d.uav_alt);
    dr.fix = num(d.uav_fix);
    dr.height = num(d.uav_height);
    dr.yaw = num(d.uav_yaw);
    dr.speed = Math.hypot(num(d.uav_vn), num(d.uav_ve));
    dr.vup = num(d.uav_vu);
    dr.airborne = Boolean(d.uav_airborne);
    dr.motor = Boolean(d.uav_motor);

    dr.track.setLatLngs(points);
    dr.marker.setLatLng(pos);

    if (hasPoint(d.uav_home)) {
        const home = [d.uav_home[1], d.uav_home[0]];
        if (dr.home == null) {
            dr.home = L.marker(home, { icon: auxIcon(dr, 'fa-house'), zIndexOffset: 900 })
                .bindPopup(() => `<div class="kestrel-popup"><b>${dr.name}</b><br>Home / takeoff point</div>`);
            dr.group.addLayer(dr.home);
        }
        dr.home.setLatLng(home);
    }

    if (hasPoint(d.uav_operator)) {
        const op = [d.uav_operator[1], d.uav_operator[0]];
        if (dr.operator == null) {
            dr.operator = L.marker(op, { icon: auxIcon(dr, 'fa-person'), zIndexOffset: 900 })
                .bindPopup(() => `<div class="kestrel-popup"><b>${dr.name}</b><br>Operator / controller position</div>`);
            dr.link = L.polyline([op, pos], { color: dr.color, weight: 1.5, opacity: 0.7, dashArray: '4 6' });
            dr.group.addLayer(dr.operator).addLayer(dr.link);
        }
        dr.operator.setLatLng(op);
        dr.link.setLatLngs([op, pos]);
        dr.operatorPos = op;
    }

    dr.stale = null;    // force the icon to redraw with the new heading/staleness
    refreshDroneIcon(dr);

    if (isNew && setting('kestrel.drones.jump') && map.hasLayer(droneLayer)) {
        map.setView(pos, Math.max(map.getZoom(), 15));
        viewInitialized = true;
    }

    return isNew;
}

function removeDrone(dr) {
    droneLayer.removeLayer(dr.group);
    drones.delete(dr.key);
}

function dronePopup(dr) {
    const lines = [];
    const what = [dr.manuf, dr.model].filter((s) => s).join(' ');
    if (what)
        lines.push(`Drone: ${what}`);
    if (dr.serial)
        lines.push(`Serial: ${dr.serial}`);
    lines.push(`MAC: ${kismet.censorMAC(dr.mac)}`);
    if (dr.match)
        lines.push(`Identified by: ${dr.match}`);
    lines.push(`Position: ${kismet.censorLocation(dr.pos[0].toFixed(5))}, ${kismet.censorLocation(dr.pos[1].toFixed(5))}`);
    // Wi-Fi DroneID leaves altitude at 0 even with a 3D fix; only RF capture fills it.
    if (dr.alt)
        lines.push(`Altitude: ${dr.alt.toFixed(0)} m`);
    if (dr.height)
        lines.push(`Height above takeoff: ${dr.height.toFixed(0)} m`);
    if (dr.speed || dr.vup)
        lines.push(`Speed: ${(dr.speed * 3.6).toFixed(0)} km/h` + (dr.vup ? `, ${dr.vup > 0 ? 'climbing' : 'descending'} ${Math.abs(dr.vup).toFixed(1)} m/s` : ''));
    if (dr.yaw)
        lines.push(`Heading: ${Math.round(dr.yaw * 180 / Math.PI)}&deg;`);
    if (dr.operatorPos)
        lines.push(`Operator: ${map.distance(dr.operatorPos, dr.pos).toFixed(0)} m away`);
    lines.push(`Status: ${dr.airborne ? 'airborne' : (dr.motor ? 'motors on' : 'unknown')}` + (dr.stale ? ', no telemetry for over a minute' : ''));
    lines.push(`Last telemetry: ${new Date(dr.last_time * 1000).toLocaleString()}`);
    lines.push(`Track: ${dr.track.getLatLngs().length} points`);

    return `<div class="kestrel-popup">
        <b>${dr.name || '(unnamed drone)'}</b><br>
        ${lines.join('<br>\n        ')}<br>
        <a href="#" class="kestrel-detail" data-key="${dr.key}">Device details</a>
    </div>`;
}

function droneMatchesSearch(dr, term) {
    if (term === '')
        return true;
    return [dr.name, dr.mac, dr.manuf, dr.model, dr.serial, dr.match, 'drone', 'uav']
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(term));
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

        // A drone with telemetry is plotted whether or not Kismet located it.
        if (hasPoint(d.uav_pos) && droneLayer != null)
            updateDrone(d);

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

        // Fields absent from a record are simplified to 0 by Kismet.
        rec.crypt = typeof d.crypt === 'string' ? d.crypt : '';
        rec.freq = Number(d.freq) || 0;
        rec.chan = typeof d.chan === 'string' ? d.chan : '';
        rec.ht = typeof d.ht === 'string' ? d.ht : '';
        rec.ietags = Array.isArray(d.ietags) ? d.ietags : null;
        rec.uav = typeof d.uav_match === 'string' && d.uav_match !== ''
            ? { manuf: d.uav_manuf, model: d.uav_model, serial: d.uav_serial, match: d.uav_match }
            : null;

        rec.security = securityFor(rec.crypt);
        rec.enterprise = ENTERPRISE_RE.test(rec.crypt);
        rec.band = bandFor(rec.freq);
        rec.gen = generationFor(rec);

        if (rec.marker.category !== rec.security)
            changed = true;
        rec.marker.category = rec.security;
        rec.marker.data.icon = markerIcon(rec);
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
        for (const dr of [...drones.values()]) {
            if (!seen.has(dr.key))
                removeDrone(dr);
        }
    }

    return changed;
}

function popupFor(data) {
    // Strings were escaped by kismet.sanitizeObject when they arrived.
    const r = data.rec;
    const seen = r.last_time ? new Date(r.last_time * 1000).toLocaleString() : 'unknown';
    const signal = r.signal ? `${r.signal} dBm` : 'unknown';

    const radio = [];
    if (r.chan)
        radio.push(`channel ${r.chan}`);
    if (r.freq)
        radio.push(`${Math.round(r.freq / 1000)} MHz`);
    if (r.band)
        radio.push(BANDS[r.band].name);

    const lines = [
        `MAC: ${kismet.censorMAC(r.mac)}`,
        `Type: ${r.type} (${r.phy})`,
        `Manufacturer: ${r.manuf}`,
    ];
    if (r.uav != null) {
        const what = [r.uav.manuf, r.uav.model].filter((s) => typeof s === 'string' && s).join(' ');
        lines.push(`Drone: ${what || 'unknown model'}${typeof r.uav.serial === 'string' && r.uav.serial ? `, serial ${r.uav.serial}` : ''} (${r.uav.match})`);
    }
    if (r.phy === 'IEEE802.11')
        lines.push(`Security: ${securityLabel(r)}${r.enterprise ? ', enterprise' : ''}`);
    if (radio.length)
        lines.push(`Radio: ${radio.join(' &middot; ')}`);
    const gen = generationLabel(r);
    if (gen)
        lines.push(`Wi-Fi: ${gen}`);
    lines.push(`Signal: ${signal}`, `Last seen: ${seen}`);

    return `<div class="kestrel-popup">
        <b>${r.name || '(unnamed)'}</b><br>
        ${lines.join('<br>\n        ')}<br>
        <a href="#" class="kestrel-detail" data-key="${r.key}">Device details</a>
    </div>`;
}

function currentSearchTerm() {
    return String($('#kestrel_filter').val() || '').trim().toLowerCase();
}

function matchesSearch(rec, term) {
    if (term === '')
        return true;
    const haystack = [
        rec.name, rec.mac, rec.type, rec.manuf, rec.phy, rec.crypt, rec.chan,
        SECURITY[rec.security].name,
        rec.band != null ? BANDS[rec.band].name : '',
        rec.gen != null ? `wi-fi ${rec.gen}` : '',
        rec.enterprise ? 'enterprise' : '',
        rec.uav != null ? `drone uav ${rec.uav.manuf} ${rec.uav.model} ${rec.uav.serial}` : '',
    ];
    return haystack.some((v) => typeof v === 'string' && v.toLowerCase().includes(term));
}

function applyFilter() {
    if (cluster == null)
        return;
    const term = currentSearchTerm();
    for (const rec of devices.values())
        rec.marker.filtered = !matchesSearch(rec, term);
    for (const dr of drones.values()) {
        dr.shown = droneMatchesSearch(dr, term);
        if (dr.shown && !droneLayer.hasLayer(dr.group))
            droneLayer.addLayer(dr.group);
        else if (!dr.shown && droneLayer.hasLayer(dr.group))
            droneLayer.removeLayer(dr.group);
    }
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

    // Tab activation and map start both schedule a poll; never run two chains.
    if (pollInFlight)
        return;

    // Don't hammer the server while the tab or window is hidden.
    if (map == null || !kismet_ui.window_visible || !$('#kestrel_map').is(':visible')) {
        schedulePoll(1000);
        return;
    }
    pollInFlight = true;

    const configured = Math.max(1, Number(setting('kestrel.poll.interval')) || DEFAULTS['kestrel.poll.interval']);
    const interval = Math.min(MAX_BACKOFF_SECONDS, configured * backoffFactor);
    effectiveInterval = interval;
    const full = (Date.now() - lastFullLoad) > FULL_RESYNC_SECONDS * 1000;
    // The window overlaps the previous poll so a slow response cannot drop devices.
    const since = full ? null : Math.ceil(interval * 2 + 1);
    const firstBatch = devices.size === 0;
    const started = Date.now();

    fetchDevices(since)
        .done((data) => {
            const list = kismet.sanitizeObject(Array.isArray(data) ? data : []);
            const changed = ingest(list, full);
            if (full)
                lastFullLoad = Date.now();
            lastUpdate = new Date();
            stats.polls++;
            if (full)
                stats.fullLoads++;
            stats.lastPollMs = Date.now() - started;

            // Judge server load by the incremental polls only; a full load is
            // expected to be slow.
            if (!full) {
                const seconds = stats.lastPollMs / 1000;
                if (seconds > configured / 2)
                    backoffFactor = Math.min(backoffFactor * 2, MAX_BACKOFF_SECONDS / configured);
                else if (backoffFactor > 1 && seconds < configured / 4)
                    backoffFactor = Math.max(1, backoffFactor / 2);
            }

            if (changed || currentSearchTerm() !== appliedSearchTerm)
                applyFilter();
            else
                updateStatus();

            if (firstBatch && devices.size > 0 && !viewInitialized)
                fitDevices();
        })
        .fail((xhr) => {
            console.warn('kestrel: device fetch failed', xhr.status, xhr.statusText);
            backoffFactor = Math.min(backoffFactor * 2, MAX_BACKOFF_SECONDS / configured);
        })
        .always(() => {
            pollInFlight = false;
            schedulePoll(Math.min(MAX_BACKOFF_SECONDS, configured * backoffFactor) * 1000);
        });
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
            <div><input type="checkbox" id="kestrel_s_drones">
                 <label for="kestrel_s_drones">Show drones at their broadcast position</label></div>
            <div><input type="checkbox" id="kestrel_s_dronejump">
                 <label for="kestrel_s_dronejump">Jump to a drone when it is first seen</label></div>
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
        $('#kestrel_s_drones', elem).prop('checked', setting('kestrel.drones.enabled'));
        $('#kestrel_s_dronejump', elem).prop('checked', setting('kestrel.drones.jump'));
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
        kismet.putStorage('kestrel.drones.enabled', $('#kestrel_s_drones', elem).is(':checked'));
        kismet.putStorage('kestrel.drones.jump', $('#kestrel_s_dronejump', elem).is(':checked'));
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
    showDrones(setting('kestrel.drones.enabled'));
}

// Handy from the browser console: kestrel.getDevices(), kestrel.getDrones()
export function getDevices() {
    return devices;
}

export function getDrones() {
    return drones;
}

export function getStats() {
    return Object.assign({ backoffFactor: backoffFactor, effectiveInterval: effectiveInterval }, stats);
}
