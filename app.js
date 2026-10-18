/* Map — a Google-Maps-style UI on free, open map services.
 *   Map tiles: OpenFreeMap (OpenStreetMap data, no API key)
 *   Search:    Photon by Komoot
 *   Nearby:    Overpass API
 *   Routing:   OSRM (routing.openstreetmap.de)
 * Swap any endpoint below for your own self-hosted instance in production.
 */
const CONFIG = {
  styles: {
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    positron: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
    satellite: {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        sat: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
  },
  photon: 'https://photon.komoot.io',
  // Tried in order; the public servers are often busy, so we fall back to mirrors.
  overpass: ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'],
  osrm: { car: 'https://routing.openstreetmap.de/routed-car', bike: 'https://routing.openstreetmap.de/routed-bike', foot: 'https://routing.openstreetmap.de/routed-foot' },
  defaultView: { center: [78.9629, 22.5937], zoom: 4.2 },
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const ICONS = {
  pin: '<svg viewBox="0 0 27 43"><path fill="#ea4335" stroke="#a52714" d="M13.5 1C6.6 1 1 6.6 1 13.5 1 23 13.5 42 13.5 42S26 23 26 13.5C26 6.6 20.4 1 13.5 1z"/><circle cx="13.5" cy="13.5" r="5" fill="#a52714"/></svg>',
  directions: '<svg viewBox="0 0 24 24"><path d="M21.7 11.3l-9-9a1 1 0 00-1.4 0l-9 9a1 1 0 000 1.4l9 9a1 1 0 001.4 0l9-9a1 1 0 000-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2zm0 15l-5-2.2L7 18V5h10v13z"/></svg>',
  saved: '<svg viewBox="0 0 24 24"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 00-2 .8L8.9 12.7a3 3 0 000-1.4L16 7.2A3 3 0 1015 5c0 .2 0 .5.1.7L8 9.8a3 3 0 100 4.4l7.1 4.2-.1.6a3 3 0 103-3z"/></svg>',
  nearby: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M18.9 6a1.5 1.5 0 00-1.4-1h-11a1.5 1.5 0 00-1.4 1L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.1-6zM6.5 16a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
  bike: '<svg viewBox="0 0 24 24"><path d="M15.5 5.5a2 2 0 100-4 2 2 0 000 4zM5 12a5 5 0 100 10 5 5 0 000-10zm0 8.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm5.8-10l2.4-2.4.8.8a7 7 0 005 2.1V9a5 5 0 01-3.6-1.5l-1.9-1.9a2 2 0 00-1.4-.6 2 2 0 00-1.4.6L7.8 8.4a2 2 0 00-.6 1.4c0 .6.3 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12a5 5 0 100 10 5 5 0 000-10zm0 8.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/></svg>',
  foot: '<svg viewBox="0 0 24 24"><path d="M13.5 5.5a2 2 0 100-4 2 2 0 000 4zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0019 13v-2a5 5 0 01-4.3-2.4l-1-1.6a2 2 0 00-1.7-1c-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
  smallPin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7z"/></svg>',
};

/* ---------------- Category emoji ---------------- */
const CAT_EMOJI = {
  restaurant: '🍴', fast_food: '🍔', cafe: '☕', bar: '🍸', pub: '🍺', hotel: '🛏️', hostel: '🛏️', guest_house: '🛏️',
  fuel: '⛽', supermarket: '🛒', convenience: '🏪', pharmacy: '💊', hospital: '🏥', clinic: '🏥', doctors: '🩺',
  school: '🏫', university: '🎓', college: '🎓', park: '🌳', bank: '🏦', atm: '🏧', parking: '🅿️',
  place_of_worship: '🛐', museum: '🏛️', cinema: '🎬', station: '🚉', bus_station: '🚌', bus_stop: '🚏', aerodrome: '✈️',
  city: '🏙️', town: '🏘️', village: '🏡', country: '🌍', state: '🗺️', house: '🏠', residential: '🏘️', attraction: '📸',
  viewpoint: '🔭', peak: '⛰️', beach: '🏖️', water: '💧', river: '🌊', mall: '🛍️', clothes: '👕', bakery: '🥐',
};
const emojiFor = (p) => CAT_EMOJI[p.value] || CAT_EMOJI[p.type] || '📍';

/* ---------------- State ---------------- */
const state = {
  styleKey: localStorage.getItem('map.style') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'liberty'),
  place: null,
  placeMarker: null,
  resultMarkers: [],
  results: null,
  dir: { from: null, to: null, mode: 'car', routes: [], active: 0, showSteps: false },
  dirMarkers: [],
  me: null,
  meMarker: null,
  measure: { on: false, pts: [], markers: [] },
  ctxLngLat: null,
  saved: JSON.parse(localStorage.getItem('map.saved') || '[]'),
};

/* ---------------- Map ---------------- */
const map = new maplibregl.Map({
  container: 'map',
  style: CONFIG.styles[state.styleKey] || CONFIG.styles.liberty,
  center: CONFIG.defaultView.center,
  zoom: CONFIG.defaultView.zoom,
  hash: 'map',
  attributionControl: { compact: true },
  dragRotate: true,
});
// Some OpenFreeMap styles reference icons their sprite doesn't include; use a blank one instead of logging warnings.
map.on('styleimagemissing', (e) => { if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
applyStyleUI();

map.on('style.load', () => { addOverlayLayers(); renderRoutes(); renderMeasure(); });

function addOverlayLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['routes', 'measure']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
  const add = (l) => { if (!map.getLayer(l.id)) map.addLayer(l); };
  add({ id: 'route-alt-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], false],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8a9bb0', 'line-width': 9 } });
  add({ id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], false],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#bccfe8', 'line-width': 6 } });
  add({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1557b0', 'line-width': 10 } });
  add({ id: 'route-line', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'active'], true], ['!=', ['get', 'mode'], 'foot']],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': 7 } });
  add({ id: 'route-line-foot', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'active'], true], ['==', ['get', 'mode'], 'foot']],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': 7, 'line-dasharray': [0.1, 1.8] } });
  add({ id: 'measure-line', type: 'line', source: 'measure', paint: { 'line-color': '#202124', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
}

/* ---------------- Helpers ---------------- */
/** Replay the staggered entrance animation on a container (see .reveal in style.css). */
function reveal(el) {
  if (!el) return;
  el.classList.remove('reveal'); void el.offsetWidth; el.classList.add('reveal');
  clearTimeout(el._swapT); el._swapT = setTimeout(() => el.classList.remove('reveal'), 700);
}
/** Shimmering placeholder rows while something loads. */
function skeleton(label, rows = 5) {
  const widths = ['w1', 'w2', 'w3'];
  return `<div class="skel-head"><div class="spinner"></div>${esc(label)}</div>` + Array.from({ length: rows }, (_, i) => `
    <div class="skel-row" style="opacity:${1 - i * 0.14}"><div class="sk sk-icon"></div><div class="sk-lines"><div class="sk sk-line ${widths[i % 3]}"></div><div class="sk sk-line ${widths[(i + 1) % 3]}" style="height:9px"></div></div></div>`).join('');
}
function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg;
  t.classList.remove('hidden', 'leaving'); void t.offsetWidth;
  clearTimeout(toast._t); clearTimeout(toast._t2);
  toast._t = setTimeout(() => { t.classList.add('leaving'); toast._t2 = setTimeout(() => t.classList.add('hidden'), 200); }, ms);
}
async function copy(text, msg = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copy:', text); }
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10 || Math.round(m)} m`);
function fmtDur(s) {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} hr`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
const fmtCoord = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** Run an Overpass QL query, trying each mirror until one answers. */
async function overpass(query, signal) {
  let lastErr;
  for (const url of CONFIG.overpass) {
    try {
      const timeout = AbortSignal.timeout(7000);
      return await getJSON(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}
async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* Human-readable labels for OSM tag values */
const CAT_LABEL = {
  yes: '', house: 'Address', residential: 'Residential area', administrative: 'Region', place_of_worship: 'Place of worship',
  fast_food: 'Fast food', bus_stop: 'Bus stop', bus_station: 'Bus station', aerodrome: 'Airport', station: 'Station',
  guest_house: 'Guest house', fuel: 'Petrol pump', marketplace: 'Market', mall: 'Shopping mall', attraction: 'Attraction',
  neighbourhood: 'Neighbourhood', suburb: 'Area', hamlet: 'Hamlet', locality: 'Locality', primary: 'Road', secondary: 'Road',
  tertiary: 'Road', trunk: 'Highway', motorway: 'Highway', unclassified: 'Road', service: 'Road', living_street: 'Street',
};
const catLabel = (v) => { if (!v) return ''; if (v in CAT_LABEL) return CAT_LABEL[v]; const t = v.replace(/_/g, ' '); return t[0].toUpperCase() + t.slice(1); };

/* Photon feature -> place */
function photonToPlace(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const line1 = [p.housenumber, p.street].filter(Boolean).join(' ');
  const locality = p.locality || p.district;
  const city = p.city || p.town || p.village || p.county;
  const parts = [line1, locality, city, p.state, p.postcode, p.country].filter(Boolean);
  const unique = parts.filter((x, i) => parts.indexOf(x) === i && x !== p.name);
  const shortParts = [line1 || locality, city, city ? null : p.state, p.country !== 'India' && !city ? p.country : null].filter(Boolean);
  return {
    name: p.name || line1 || city || p.state || p.country || 'Dropped pin',
    type: p.osm_key, value: p.osm_value,
    category: catLabel(p.osm_value === 'yes' ? p.osm_key : p.osm_value),
    address: unique.join(', '),
    short: [...new Set(shortParts)].filter((x) => x !== p.name).slice(0, 3).join(', ') || [p.state, p.country].filter(Boolean).join(', '),
    lat, lon, extent: p.extent, osm: p.osm_type && p.osm_id ? { type: p.osm_type, id: p.osm_id } : null, tags: {},
  };
}
/* Overpass element -> place */
function overpassToPlace(el, cat) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city'], t['addr:postcode']].filter(Boolean).join(', ');
  const value = t.amenity || t.shop || t.tourism || t.leisure || cat;
  return {
    name: t.name || t['name:en'] || value.replace(/_/g, ' '), value, type: value,
    category: [value, t.cuisine].filter(Boolean).join(' · ').replace(/_/g, ' ').replace(/;/g, ', '),
    address: addr, short: addr, lat, lon, osm: { type: el.type[0].toUpperCase(), id: el.id }, tags: t,
  };
}
const OSM_TYPE = { N: 'node', W: 'way', R: 'relation' };

/* ---------------- Search ---------------- */
const searchInput = $('#search-input');
const suggestionsEl = $('#suggestions');

/* Recent searches (stored in the browser) */
const recent = {
  list: () => JSON.parse(localStorage.getItem('map.recent') || '[]'),
  add(p) {
    const item = { name: p.name, short: p.short, category: p.category, value: p.value, type: p.type, lat: p.lat, lon: p.lon, address: p.address, osm: p.osm, extent: p.extent };
    const l = recent.list().filter((r) => !(r.name === item.name && Math.abs(r.lat - item.lat) < 1e-5));
    localStorage.setItem('map.recent', JSON.stringify([item, ...l].slice(0, 8)));
  },
  clear: () => localStorage.removeItem('map.recent'),
};

/* Typed category words -> nearby search. Keys match CHIP_FILTERS. */
const CATEGORY_WORDS = {
  restaurant: ['restaurant', 'restaurants', 'food', 'dinner', 'lunch', 'eat', 'dhaba'], cafe: ['cafe', 'cafes', 'coffee', 'tea', 'chai'],
  hotel: ['hotel', 'hotels', 'stay', 'lodging', 'hostel'], fuel: ['petrol', 'gas', 'fuel', 'petrol pump', 'gas station', 'diesel', 'cng'],
  supermarket: ['grocery', 'groceries', 'supermarket', 'kirana', 'store'], pharmacy: ['pharmacy', 'medical', 'medical store', 'chemist', 'medicine'],
  park: ['park', 'parks', 'garden'], atm: ['atm', 'atms', 'cash'], hospital: ['hospital', 'hospitals', 'clinic', 'doctor'],
};
const CAT_TITLE = { restaurant: '🍴 Restaurants', cafe: '☕ Coffee', hotel: '🛏️ Hotels', fuel: '⛽ Petrol pumps', supermarket: '🛒 Groceries', pharmacy: '💊 Pharmacies', park: '🌳 Parks', atm: '🏧 ATMs', hospital: '🏥 Hospitals' };
function matchCategory(q) {
  const t = q.toLowerCase().replace(/\b(near me|nearby|near by|around me|close by)\b/g, '').trim();
  if (!t) return null;
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) if (words.some((w) => w === t || (t.length >= 3 && w.startsWith(t)))) return cat;
  return null;
}
/* "28.6129, 77.2295" or "28.6129 77.2295" -> {lat, lon} */
function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)[\s,;]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/* Bold the part of the name that matches what was typed. */
function highlight(name, q) {
  if (!q) return esc(name);
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(name);
  return `${esc(name.slice(0, i))}<b>${esc(name.slice(i, i + q.length))}</b>${esc(name.slice(i + q.length))}`;
}
function distanceLabel(p) {
  if (p.lat == null) return '';
  const ref = state.me ? [state.me.lon, state.me.lat] : map.getZoom() >= 9 ? [map.getCenter().lng, map.getCenter().lat] : null;
  return ref ? fmtDist(haversine(ref, [p.lon, p.lat])) : '';
}

/**
 * Wire an <input> to the suggestion list.
 * onPick(item) gets a place, or a special item ({action:'search'|'category'|'coords'|'clear-recent'}).
 * extra(q) returns rows to show above the live results (recents, "Your location", ...).
 */
function attachAutocomplete(input, list, onPick, { extra = () => [], allowActions = false } = {}) {
  let items = [], active = -1, seq = 0, loading = false, lastQ = '';
  const card = input.closest('#search-card');
  const rowHTML = (it, i) => {
    if (it.header) return `<li class="s-header" data-i="${i}" style="--i:${i}">${esc(it.header)}${it.clear ? '<button class="s-clear" data-clear="1">Clear</button>' : ''}</li>`;
    const sub = [it.category && it.category !== it.name ? it.category : '', it.short].filter(Boolean).join(' · ');
    const dist = it.action ? '' : distanceLabel(it);
    return `
      <li data-i="${i}" style="--i:${i}" class="${i === active ? 'active' : ''} ${it.action ? 's-action' : ''}">
        <span class="s-icon ${it.iconClass || ''}">${it.icon || emojiFor(it)}</span>
        <span class="s-text"><div class="s-name">${it.action ? esc(it.name) : highlight(it.name, lastQ)}</div>${sub ? `<div class="s-sub">${esc(sub)}</div>` : ''}</span>
        ${dist ? `<span class="s-dist">${dist}</span>` : ''}
      </li>`;
  };
  const render = (animate = false) => {
    const rows = items.map(rowHTML).join('') + (loading && !items.some((i) => !i.header && !i.action) ? '<li class="s-loading"><div class="spinner"></div>Searching…</li>' : '');
    if (!rows) { list.classList.add('hidden'); card?.classList.remove('open'); return; }
    const wasHidden = list.classList.contains('hidden');
    list.innerHTML = rows;
    list.classList.toggle('animate', animate || wasHidden);
    list.classList.remove('hidden');
    card?.classList.add('open');
  };
  const selectable = () => items.map((it, i) => (it.header ? -1 : i)).filter((i) => i >= 0);
  const close = () => { seq++; items = []; active = -1; loading = false; render(); };
  const local = (q) => {
    const rows = [...extra(q)];
    if (allowActions && q) {
      const coords = parseCoords(q);
      if (coords) rows.unshift({ action: 'coords', ...coords, name: `Go to ${fmtCoord(coords.lat, coords.lon)}`, icon: '🧭' });
      const parsed = Search.parse(q);
      const cat = matchCategory(parsed.where ? parsed.what : q);
      const catName = cat && CAT_TITLE[cat].replace(/^\S+\s/, '');
      if (cat && parsed.where) rows.unshift({ action: 'category', cat, where: parsed.where, name: `${catName} in ${parsed.where.replace(/^./, (c) => c.toUpperCase())}`, short: 'Search that area', icon: CAT_TITLE[cat].split(' ')[0] });
      else if (cat) rows.unshift({ action: 'category', cat, name: `${catName} nearby`, short: 'Search this area', icon: CAT_TITLE[cat].split(' ')[0] });
    }
    return rows;
  };
  let abort;
  const fetchSuggestions = debounce(async (q) => {
    const my = ++seq;
    abort?.abort(); abort = new AbortController();
    try {
      const { places } = await Search.search(q, { limit: 8, signal: abort.signal });
      if (my !== seq || input.value.trim() !== q) return;
      items = [...local(q), ...places];
      if (allowActions) items.push(places.length
        ? { action: 'search', q, name: `See all results for “${q}”`, icon: '🔍' }
        : { action: 'none', name: `No places found for “${q}”`, short: 'Check the spelling or try a nearby city', icon: '🤷' });
      loading = false; active = -1; render(true);
    } catch { if (my === seq) { loading = false; render(); } }
  }, 180);

  const update = () => {
    const q = input.value.trim(); lastQ = q;
    if (q.length < 2) { seq++; loading = false; items = local(q); active = -1; render(); return; }
    items = local(q); loading = true; render();
    fetchSuggestions(q);
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (!input.value.trim() || !items.length) update(); });
  input.addEventListener('keydown', (e) => {
    const sel = selectable();
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sel.length) {
      const pos = sel.indexOf(active);
      active = sel[e.key === 'ArrowDown' ? (pos + 1) % sel.length : (pos - 1 + sel.length) % sel.length];
      render(); e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (active >= 0 && items[active]) pick(items[active]);
      else if (allowActions && q) { const c = parseCoords(q), cat = matchCategory(q); pick(c ? { action: 'coords', ...c } : cat ? { action: 'category', cat } : { action: 'search', q }); }
      else { const first = items.find((i) => !i.header && !i.action); if (first) pick(first); }
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  const pick = (it) => {
    if (!it || it.header || it.action === 'none') return;
    close(); onPick(it);
  };
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.target.closest('[data-clear]')) { recent.clear(); update(); return; }
    const li = e.target.closest('li[data-i]'); if (li) pick(items[+li.dataset.i]);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}

attachAutocomplete(searchInput, suggestionsEl, (it) => {
  if (it.action === 'search') { searchInput.value = it.q; syncClear(); return runSearch(it.q); }
  if (it.action === 'category') { searchInput.value = it.name || CAT_TITLE[it.cat].replace(/^\S+\s/, ''); syncClear(); return categoryIn(it.cat, it.where); }
  if (it.action === 'coords') { searchInput.value = fmtCoord(it.lat, it.lon); syncClear(); map.flyTo({ center: [it.lon, it.lat], zoom: 16 }); return whatsHere({ lat: it.lat, lng: it.lon }); }
  searchInput.value = it.name; syncClear();
  recent.add(it);
  showPlace({ ...it, tags: {} }, { fly: true });
}, {
  allowActions: true,
  extra: (q) => {
    if (q) return [];
    const rec = recent.list().map((r) => ({ ...r, icon: '🕘', iconClass: 'muted' }));
    const saved = state.saved.slice(0, 3).map((s) => ({ ...s, icon: '⭐' }));
    return [
      ...(saved.length ? [{ header: 'Saved' }, ...saved] : []),
      ...(rec.length ? [{ header: 'Recent', clear: true }, ...rec.slice(0, 6)] : []),
    ];
  },
});
const syncClear = () => $('#clear-btn').classList.toggle('hidden', !searchInput.value);
searchInput.addEventListener('input', syncClear);
$('#clear-btn').onclick = () => { searchInput.value = ''; syncClear(); closePanel(); searchInput.focus(); };

/** Category search, optionally in a named place ("coffee in jaipur"). */
async function categoryIn(cat, where) {
  if (where) {
    const loc = await Search.resolveWhere(where).catch(() => null);
    if (!loc) { toast(`Couldn't find “${where}”`); return; }
    map.jumpTo({ center: [loc.lon, loc.lat], zoom: 14 });
  }
  return nearbySearch(cat);
}

async function runSearch(q) {
  const parsed = Search.parse(q);
  const cat = matchCategory(parsed.where ? parsed.what : q);
  if (cat) return categoryIn(cat, parsed.where);
  openPanel(skeleton('Searching…'));
  try {
    const { places, anchor } = await Search.search(q, { limit: 20, full: true });
    if (places.length === 1) { recent.add(places[0]); return showPlace(places[0], { fly: true }); }
    showResults(places, anchor ? `Results for “${parsed.what}” in ${anchor.name}` : `Results for “${q}”`);
  } catch { openPanel(`<div class="empty">Search failed. Check your connection and try again.</div>`); }
}

/* ---------------- Nearby category search (Overpass) ---------------- */
const CHIP_FILTERS = {
  restaurant: '["amenity"~"^(restaurant|fast_food)$"]', cafe: '["amenity"="cafe"]', hotel: '["tourism"~"^(hotel|hostel|guest_house|motel)$"]',
  fuel: '["amenity"="fuel"]', supermarket: '["shop"~"^(supermarket|greengrocer|convenience)$"]', pharmacy: '["amenity"="pharmacy"]',
  park: '["leisure"="park"]["name"]', atm: '["amenity"="atm"]', hospital: '["amenity"~"^(hospital|clinic)$"]',
};
// Fallback when Overpass is down: Photon keyword + OSM tag filter (only finds places whose name matches the word).
const CHIP_PHOTON = {
  restaurant: ['restaurant', ['amenity:restaurant', 'amenity:fast_food']], cafe: ['cafe', ['amenity:cafe']], hotel: ['hotel', ['tourism:hotel', 'tourism:guest_house']],
  fuel: ['petrol', ['amenity:fuel']], supermarket: ['supermarket', ['shop:supermarket']], pharmacy: ['pharmacy', ['amenity:pharmacy']], park: ['park', ['leisure:park']],
  atm: ['atm', ['amenity:atm']], hospital: ['hospital', ['amenity:hospital', 'amenity:clinic']],
};
async function nearbyViaPhoton(cat, b, signal) {
  const [q, tags] = CHIP_PHOTON[cat];
  const url = `${CONFIG.photon}/api/?q=${q}&limit=50&bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',')}` + tags.map((t) => `&osm_tag=${t}`).join('');
  return (await getJSON(url, { signal })).features.map(photonToPlace);
}
let chipAbort;
$$('.chip').forEach((chip) => chip.addEventListener('click', () => {
  if (chip.classList.contains('active')) { closePanel(); return; }
  nearbySearch(chip.dataset.q);
}));
async function nearbySearch(cat) {
  if (map.getZoom() < 11.5) {
    // Too far out: zoom to the user (or the map centre) first so the search area is sensible.
    if (state.me) map.jumpTo({ center: [state.me.lon, state.me.lat], zoom: 14 });
    else { toast('Zoom in to an area first, or tap the location button'); return; }
  }
  const title = CAT_TITLE[cat];
  $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.q === cat));
  openPanel(skeleton(`Finding ${title.replace(/^\S+\s/, '').toLowerCase()} nearby…`));
  chipAbort?.abort(); chipAbort = new AbortController();
  const b = map.getBounds();
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(',');
  const q = `[out:json][timeout:20];nwr${CHIP_FILTERS[cat]}(${bbox});out center 60;`;
  try {
    let places;
    try {
      const data = await overpass(q, chipAbort.signal);
      places = data.elements.map((el) => overpassToPlace(el, cat));
    } catch (e) {
      if (e.name === 'AbortError' && chipAbort.signal.aborted) throw e;
      places = await nearbyViaPhoton(cat, b, chipAbort.signal);
    }
    const c = map.getCenter();
    places = places.filter((p) => p.lat != null)
      .sort((a, z) => haversine([c.lng, c.lat], [a.lon, a.lat]) - haversine([c.lng, c.lat], [z.lon, z.lat]));
    showResults(places, `${title} in this area`, { keepView: true });
  } catch (e) {
    if (e.name !== 'AbortError') openPanel(`<div class="empty">Couldn't load nearby places right now. The free servers may be busy, so try again in a moment.</div>`);
  }
}

/* ---------------- Results list ---------------- */
function clearResults() { state.resultMarkers.forEach((m) => m.remove()); state.resultMarkers = []; state.results = null; }

function showResults(places, title, { keepView = false } = {}) {
  clearResults(); clearPlaceMarker();
  state.results = { places, title };
  if (!places.length) { openPanel(`<div class="results-head">${esc(title)}</div><div class="empty">No results found.</div>`); return; }
  openPanel(`<div class="results-head">${esc(title)}</div>` + places.map((p, i) => `
    <div class="result" data-i="${i}">
      <div class="r-icon">${emojiFor(p)}</div>
      <div class="r-main"><div class="r-name">${esc(p.name)}</div><div class="r-sub">${esc([p.category, p.short].filter(Boolean).join(' · '))}</div></div>
      <div class="r-dist">${distanceLabel(p)}</div>
    </div>`).join(''));
  $$('#panel .result').forEach((el) => {
    const p = places[+el.dataset.i];
    el.onclick = () => { recent.add(p); showPlace(p, { fly: true, fromResults: true }); };
  });
  const rowsEls = $$('#panel .result');
  places.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'result-dot'; el.title = p.name;
    el.style.animationDelay = `${Math.min(i, 20) * 25}ms`;
    el.addEventListener('click', (e) => { e.stopPropagation(); showPlace(p, { fromResults: true }); });
    // Hovering a dot highlights its row, and vice versa.
    el.addEventListener('mouseenter', () => { rowsEls[i]?.classList.add('hl'); rowsEls[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    el.addEventListener('mouseleave', () => rowsEls[i]?.classList.remove('hl'));
    rowsEls[i]?.addEventListener('mouseenter', () => el.classList.add('hl'));
    rowsEls[i]?.addEventListener('mouseleave', () => el.classList.remove('hl'));
    state.resultMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
  });
  if (!keepView) {
    const bounds = new maplibregl.LngLatBounds();
    places.forEach((p) => bounds.extend([p.lon, p.lat]));
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 15, duration: 800 });
  }
}

/* ---------------- Place details ---------------- */
function clearPlaceMarker() { state.placeMarker?.remove(); state.placeMarker = null; }

function setPlaceMarker(p) {
  const cur = state.placeMarker?.getLngLat();
  if (cur && Math.abs(cur.lat - p.lat) < 1e-7 && Math.abs(cur.lng - p.lon) < 1e-7) return;
  clearPlaceMarker();
  const el = document.createElement('div'); el.className = 'pin-marker'; el.innerHTML = ICONS.pin + '<span class="pin-shadow"></span>';
  state.placeMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
}

function fitPadding() {
  const mobile = innerWidth <= 640;
  const panel = !$('#panel').classList.contains('hidden');
  return mobile ? { top: 80, bottom: panel ? innerHeight * 0.58 : 60, left: 40, right: 40 }
    : { top: 80, bottom: 60, left: (panel ? 408 : 0) + 60, right: 80 };
}

function flyToPlace(p) {
  if (p.extent && !['house', 'node'].includes(p.type) && ['city', 'town', 'state', 'country', 'county', 'district', 'village', 'suburb', 'administrative'].includes(p.value)) {
    const [w, n, e, s] = p.extent;
    map.fitBounds([[w, s], [e, n]], { padding: fitPadding(), duration: 1200 });
  } else {
    const pad = fitPadding();
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), padding: pad, duration: 1200 });
  }
}

const isSaved = (p) => state.saved.some((s) => Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lon - p.lon) < 1e-6);
function persistSaved() { localStorage.setItem('map.saved', JSON.stringify(state.saved)); }

async function showPlace(p, { fly = false, fromResults = false } = {}) {
  const isNew = state.place !== p;
  state.place = p;
  if (!fromResults) clearResults();
  setPlaceMarker(p);
  renderPlace(p, fromResults, isNew);
  if (fly) flyToPlace(p);
  // Enrich with OSM tags (phone, website, hours) when we only have a Photon hit.
  if (p.osm && !Object.keys(p.tags).length && ['N', 'W', 'R'].includes(p.osm.type)) {
    try {
      const q = `[out:json][timeout:10];${OSM_TYPE[p.osm.type]}(${p.osm.id});out tags;`;
      const data = await overpass(q);
      const tags = data.elements[0]?.tags;
      if (tags && state.place === p) { p.tags = tags; renderPlace(p, fromResults, false); }
    } catch { /* optional */ }
  }
}

function renderPlace(p, fromResults, animate = true) {
  const t = p.tags || {};
  const rows = [];
  if (p.address) rows.push(['📍', esc(p.address), 'addr']);
  if (t.opening_hours) rows.push(['🕒', esc(t.opening_hours.replace(/;\s*/g, '; '))]);
  const site = t.website || t['contact:website'];
  if (site) rows.push(['🌐', `<a href="${esc(/^https?:/.test(site) ? site : 'https://' + site)}" target="_blank" rel="noopener">${esc(site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`]);
  const phone = t.phone || t['contact:phone'];
  if (phone) rows.push(['📞', `<a href="tel:${esc(phone.split(';')[0])}">${esc(phone.split(';')[0])}</a>`]);
  if (t.wheelchair) rows.push(['♿', `Wheelchair access: ${esc(t.wheelchair)}`]);
  rows.push(['🧭', fmtCoord(p.lat, p.lon), 'coords']);
  if (state.me) rows.push(['📏', `${fmtDist(haversine([state.me.lon, state.me.lat], [p.lon, p.lat]))} from you (straight line)`]);

  const osmLink = p.osm ? `https://www.openstreetmap.org/${OSM_TYPE[p.osm.type]}/${p.osm.id}` : `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;
  openPanel(`
    ${fromResults && state.results ? `<button class="steps-toggle" id="back-results" style="margin:-56px 0 16px 16px;display:flex;gap:6px;align-items:center;position:relative">${ICONS.back} Back to results</button>` : ''}
    <div class="place-hero" id="pe-hero"><span>${emojiFor(p)}</span></div>
    <div class="place-head"><h1>${esc(p.name)}</h1><div class="cat">${esc(p.category)}</div><div id="pe-status"></div></div>
    <div class="actions">
      <button class="action primary" data-a="dir"><span class="circ">${ICONS.directions}</span>Directions</button>
      <button class="action" data-a="save"><span class="circ">${isSaved(p) ? ICONS.saved : ICONS.save}</span>${isSaved(p) ? 'Saved' : 'Save'}</button>
      <button class="action" data-a="nearby"><span class="circ">${ICONS.nearby}</span>Nearby</button>
      <button class="action" data-a="share"><span class="circ">${ICONS.share}</span>Share</button>
    </div>
    <div id="pe-about"></div>
    ${rows.map(([i, h, k]) => `<div class="info-row" ${k ? `data-k="${k}"` : ''}><span class="ir-icon">${i}</span><span>${h}</span></div>`).join('')}
    <div id="pe-extra-rows"></div>
    <div id="pe-weather"></div>
    <div id="pe-photos-grid"></div>
    <div id="pe-nearby"></div>
    <div class="attribution-note">Data from <a href="${osmLink}" target="_blank" rel="noopener">OpenStreetMap</a>. Something wrong? <a href="https://www.openstreetmap.org/note/new#map=18/${p.lat}/${p.lon}" target="_blank" rel="noopener">Suggest an edit</a>.</div>
  `, { animate, keepScroll: !animate });
  $('#back-results')?.addEventListener('click', () => showResults(state.results.places, state.results.title, { keepView: true }));
  if (typeof PlaceExtras !== 'undefined') PlaceExtras.render(p);
  $$('#panel .info-row[data-k]').forEach((r) => r.addEventListener('click', () =>
    copy(r.dataset.k === 'coords' ? fmtCoord(p.lat, p.lon) : p.address, r.dataset.k === 'coords' ? 'Coordinates copied' : 'Address copied')));
  $$('#panel .action').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'dir') openDirections({ to: placeToWaypoint(p) });
    else if (a === 'save') {
      if (isSaved(p)) state.saved = state.saved.filter((s) => !(Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lon - p.lon) < 1e-6));
      else state.saved.unshift({ name: p.name, category: p.category, address: p.address, short: p.short, lat: p.lat, lon: p.lon, value: p.value, type: p.type, osm: p.osm, tags: {} });
      persistSaved(); renderPlace(p, fromResults, false); toast(isSaved(p) ? 'Saved to your places' : 'Removed from saved');
      $('#panel .action[data-a="save"]')?.classList.add('just-toggled');
    } else if (a === 'nearby') { searchInput.value = ''; searchInput.placeholder = `Search nearby ${p.name}`; map.jumpTo({ center: [p.lon, p.lat] }); searchInput.focus(); }
    else if (a === 'share') {
      const url = `${location.origin}${location.pathname}?q=${encodeURIComponent(p.name)}&ll=${p.lat.toFixed(6)},${p.lon.toFixed(6)}#map=17/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`;
      if (navigator.share && innerWidth <= 640) navigator.share({ title: p.name, url }).catch(() => {}); else copy(url, 'Link copied');
    }
  }));
}

/* ---------------- Panel ---------------- */
function openPanel(html, { animate = true, keepScroll = false } = {}) {
  const panel = $('#panel'), content = $('#panel-content');
  clearTimeout(closePanel._t);
  panel.classList.remove('closing');
  content.innerHTML = html;
  panel.classList.remove('hidden');
  if (!keepScroll) panel.scrollTop = 0;
  if (animate) reveal(content);
  document.body.classList.add('panel-open');
}
function closePanel() {
  const panel = $('#panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('closing');
    clearTimeout(closePanel._t);
    closePanel._t = setTimeout(() => { panel.classList.add('hidden'); panel.classList.remove('closing'); }, 180);
  }
  document.body.classList.remove('panel-open', 'directions-mode');
  clearPlaceMarker(); clearResults(); clearRoute(); state.place = null;
  $$('.chip').forEach((c) => c.classList.remove('active'));
  searchInput.placeholder = 'Search places, addresses, coordinates';
}

/* ---------------- Reverse geocode ---------------- */
async function whatsHere(lngLat) {
  const pin = { name: 'Dropped pin', category: '', address: '', short: '', lat: lngLat.lat, lon: lngLat.lng, tags: {} };
  showPlace(pin);
  try {
    const data = await getJSON(`${CONFIG.photon}/reverse?lat=${lngLat.lat}&lon=${lngLat.lng}&limit=1`);
    const f = data.features[0];
    if (f && state.place === pin) {
      const p = photonToPlace(f);
      const dist = haversine([p.lon, p.lat], [pin.lon, pin.lat]);
      Object.assign(pin, { address: [p.name !== 'Dropped pin' ? p.name : '', p.address].filter(Boolean).join(', '), short: p.short,
        category: dist < 30 ? p.category : 'Dropped pin', name: dist < 30 ? p.name : 'Dropped pin', value: p.value, type: p.type, osm: dist < 30 ? p.osm : null });
      showPlace(pin);
    }
  } catch { /* keep coords only */ }
}

/* Click on a labelled POI on the base map */
map.on('click', (e) => {
  if (state.measure.on) return addMeasurePoint(e.lngLat);
  hideCtx();
  const feats = map.queryRenderedFeatures(e.point).filter((f) => f.properties?.name && ['poi', 'place', 'aerodrome_label', 'transportation_name', 'mountain_peak', 'water_name'].includes(f.sourceLayer) && f.layer.type === 'symbol');
  const poi = feats.find((f) => f.sourceLayer === 'poi' || f.sourceLayer === 'aerodrome_label' || f.sourceLayer === 'mountain_peak') || feats.find((f) => f.sourceLayer === 'place');
  if (!poi) return;
  const pr = poi.properties;
  const [lon, lat] = poi.geometry.type === 'Point' ? poi.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
  const p = { name: pr['name:en'] && pr['name:en'] !== pr.name ? `${pr.name} (${pr['name:en']})` : pr.name, value: pr.subclass || pr.class, type: pr.class,
    category: (pr.subclass || pr.class || '').replace(/_/g, ' '), address: '', short: '', lat, lon, tags: {}, osm: null };
  showPlace(p);
  // Fill in address and OSM id via reverse geocoding close to the label.
  getJSON(`${CONFIG.photon}/reverse?lat=${lat}&lon=${lon}&limit=5&radius=0.1`).then((data) => {
    if (state.place !== p) return;
    const match = data.features.map(photonToPlace).find((x) => x.name === pr.name) || data.features.map(photonToPlace)[0];
    if (match) { p.address = match.address; p.short = match.short; if (match.name === pr.name) p.osm = match.osm; showPlace(p); }
  }).catch(() => {});
});
const POI_LAYERS = () => map.getStyle().layers.filter((l) => l.type === 'symbol' && ['poi', 'aerodrome_label', 'mountain_peak'].includes(l['source-layer'])).map((l) => l.id);
map.on('mousemove', (e) => {
  if (state.measure.on) { map.getCanvas().style.cursor = 'crosshair'; return; }
  let hit = false;
  try { hit = map.queryRenderedFeatures(e.point, { layers: POI_LAYERS() }).some((f) => f.properties?.name); } catch {}
  const routeHit = map.getLayer('route-alt') && map.queryRenderedFeatures(e.point, { layers: ['route-alt', 'route-alt-casing'] }).length;
  map.getCanvas().style.cursor = hit || routeHit ? 'pointer' : '';
});

/* ---------------- Context menu ---------------- */
const ctx = $('#ctx-menu');
function hideCtx() { ctx.classList.add('hidden'); }
function showCtxAt(point, lngLat) {
  state.ctxLngLat = lngLat;
  $('.ctx-coords', ctx).textContent = fmtCoord(lngLat.lat, lngLat.lng);
  $('[data-action="measure-reset"]', ctx).classList.toggle('hidden', !state.measure.pts.length);
  $('[data-action="measure"]', ctx).textContent = state.measure.on ? 'Add measure point here' : 'Measure distance';
  ctx.classList.remove('hidden');
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  ctx.style.left = Math.min(point.x, innerWidth - w - 8) + 'px';
  ctx.style.top = Math.min(point.y, innerHeight - h - 8) + 'px';
}
map.on('contextmenu', (e) => { e.preventDefault(); showCtxAt(e.point, e.lngLat); });
// Long-press for touch devices
let lpTimer;
map.on('touchstart', (e) => { if (e.points.length !== 1) return; lpTimer = setTimeout(() => showCtxAt(e.point, e.lngLat), 550); });
['touchend', 'touchmove', 'movestart'].forEach((ev) => map.on(ev, () => clearTimeout(lpTimer)));
map.on('movestart', hideCtx);

ctx.addEventListener('click', (e) => {
  const a = e.target.closest('li')?.dataset.action; if (!a) return;
  const ll = state.ctxLngLat; hideCtx();
  const wp = { label: fmtCoord(ll.lat, ll.lng), lat: ll.lat, lon: ll.lng };
  if (a === 'coords') copy(fmtCoord(ll.lat, ll.lng), 'Coordinates copied');
  else if (a === 'whats-here') whatsHere(ll);
  else if (a === 'from') { openDirections({ from: wp }); labelWaypoint('from', wp); }
  else if (a === 'to') { openDirections({ to: wp }); labelWaypoint('to', wp); }
  else if (a === 'measure') { startMeasure(); addMeasurePoint(ll); }
  else if (a === 'measure-reset') stopMeasure();
});
document.addEventListener('click', (e) => { if (!ctx.contains(e.target)) hideCtx(); });

/* Give a coordinate waypoint a readable name once reverse geocoding returns. */
async function labelWaypoint(which, wp) {
  try {
    const data = await getJSON(`${CONFIG.photon}/reverse?lat=${wp.lat}&lon=${wp.lon}&limit=1`);
    const f = data.features[0]; if (!f || state.dir[which] !== wp) return;
    const p = photonToPlace(f); wp.label = [p.name, p.short].filter(Boolean).join(', ').slice(0, 80);
    const inp = $(`#dir-${which}`); if (inp && document.activeElement !== inp) inp.value = wp.label;
  } catch {}
}

/* ---------------- Measure ---------------- */
function startMeasure() { state.measure.on = true; $('#measure-badge').classList.remove('hidden'); updateMeasureBadge(); }
function stopMeasure() {
  state.measure.on = false; state.measure.pts = []; state.measure.markers.forEach((m) => m.remove()); state.measure.markers = [];
  $('#measure-badge').classList.add('hidden'); renderMeasure(); map.getCanvas().style.cursor = '';
}
function addMeasurePoint(ll) {
  const el = document.createElement('div'); el.className = 'measure-dot';
  const i = state.measure.pts.length;
  el.addEventListener('click', (e) => { e.stopPropagation(); state.measure.pts.splice(i, 1); state.measure.markers.splice(i, 1)[0].remove(); renderMeasure(); updateMeasureBadge(); });
  state.measure.pts.push([ll.lng, ll.lat]);
  state.measure.markers.push(new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map));
  renderMeasure(); updateMeasureBadge();
}
function renderMeasure() {
  map.getSource('measure')?.setData({ type: 'FeatureCollection', features: state.measure.pts.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: state.measure.pts } }] : [] });
}
function updateMeasureBadge() {
  let d = 0; for (let i = 1; i < state.measure.pts.length; i++) d += haversine(state.measure.pts[i - 1], state.measure.pts[i]);
  $('#measure-badge').innerHTML = `<span>📏 ${state.measure.pts.length < 2 ? 'Click the map to add points' : `Total distance: <b>${fmtDist(d)}</b>`}</span><button id="measure-done">Done</button>`;
  $('#measure-done').onclick = stopMeasure;
}

/* ---------------- Directions ---------------- */
const placeToWaypoint = (p) => ({ label: p.name + (p.short ? `, ${p.short}` : ''), lat: p.lat, lon: p.lon });
const MY_LOCATION = { name: 'Your location', icon: '🎯', short: '', isMe: true };

function openDirections({ from, to } = {}) {
  const d = state.dir;
  if (from !== undefined) d.from = from;
  if (to !== undefined) d.to = to;
  if (!d.from && state.me && d.to) d.from = { label: 'Your location', lat: state.me.lat, lon: state.me.lon, isMe: true };
  clearResults(); clearPlaceMarker();
  document.body.classList.add('directions-mode');
  openPanel(`
    <div class="dir-top">
      <div class="dir-modes">
        ${['car', 'bike', 'foot'].map((m) => `<button class="mode ${d.mode === m ? 'active' : ''}" data-mode="${m}" title="${{ car: 'Driving', bike: 'Cycling', foot: 'Walking' }[m]}">${ICONS[m]}</button>`).join('')}
        <button class="icon-btn close" id="dir-close" title="Close directions">${ICONS.close}</button>
      </div>
      <div class="dir-fields">
        <div class="dir-dots"><span class="dot"></span><span class="vdots"></span><span class="pin">${ICONS.smallPin}</span></div>
        <div class="dir-inputs">
          <div class="dir-input-wrap"><input id="dir-from" placeholder="Choose starting point, or click on the map" value="${esc(d.from?.label || '')}" autocomplete="off"><ul class="suggestions hidden" id="dir-from-s"></ul></div>
          <div class="dir-input-wrap"><input id="dir-to" placeholder="Choose destination" value="${esc(d.to?.label || '')}" autocomplete="off"><ul class="suggestions hidden" id="dir-to-s"></ul></div>
        </div>
        <button class="swap" id="dir-swap" title="Reverse starting point and destination">${ICONS.swap}</button>
      </div>
    </div>
    <div id="dir-body"></div>
  `);
  for (const which of ['from', 'to']) {
    const input = $(`#dir-${which}`);
    attachAutocomplete(input, $(`#dir-${which}-s`), (p) => {
      if (p.isMe) { locate(true).then((me) => { if (!me) return; d[which] = { label: 'Your location', lat: me.lat, lon: me.lon, isMe: true }; input.value = 'Your location'; route(); }); return; }
      d[which] = placeToWaypoint(p); input.value = d[which].label; route();
    }, { extra: (q) => (!q || 'your location'.startsWith(q.toLowerCase())
      ? [MY_LOCATION, ...(q ? [] : [...state.saved.slice(0, 3).map((s) => ({ ...s, icon: '⭐' })), ...recent.list().slice(0, 4).map((r) => ({ ...r, icon: '🕘', iconClass: 'muted' }))])]
      : []) });
    input.addEventListener('input', () => { if (!input.value.trim()) { d[which] = null; } });
  }
  $$('.dir-modes .mode').forEach((b) => b.addEventListener('click', () => { d.mode = b.dataset.mode; $$('.dir-modes .mode').forEach((x) => x.classList.toggle('active', x === b)); route(); }));
  $('#dir-close').onclick = () => { closeDirections(); };
  $('#dir-swap').onclick = () => { [d.from, d.to] = [d.to, d.from]; $('#dir-from').value = d.from?.label || ''; $('#dir-to').value = d.to?.label || ''; route(); };
  if (!d.from) $('#dir-from').focus(); else if (!d.to) $('#dir-to').focus();
  route();
}
function closeDirections() {
  state.dir = { from: null, to: null, mode: state.dir.mode, routes: [], active: 0, showSteps: false };
  closePanel();
}

let routeSeq = 0;
async function route() {
  const d = state.dir, body = $('#dir-body');
  renderDirMarkers();
  if (!d.from || !d.to) { d.routes = []; renderRoutes(); if (body) body.innerHTML = `<div class="dir-note">Pick a start and destination. Tip: right-click anywhere on the map for “Directions from/to here”.</div>`; return; }
  const my = ++routeSeq;
  body.innerHTML = skeleton('Finding the best routes…', 3);
  const url = `${CONFIG.osrm[d.mode]}/route/v1/driving/${d.from.lon},${d.from.lat};${d.to.lon},${d.to.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  try {
    const data = await getJSON(url);
    if (my !== routeSeq) return;
    if (data.code !== 'Ok' || !data.routes.length) throw new Error(data.code);
    d.routes = data.routes; d.active = 0; d.showSteps = false;
    renderRoutes(true); renderDirections(); reveal(body);
    const bounds = new maplibregl.LngLatBounds();
    data.routes.forEach((r) => r.geometry.coordinates.forEach((c) => bounds.extend(c)));
    map.fitBounds(bounds, { padding: fitPadding(), duration: 900 });
  } catch (e) {
    if (my !== routeSeq) return;
    d.routes = []; renderRoutes();
    body.innerHTML = `<div class="empty">Sorry, we couldn't find a ${{ car: 'driving', bike: 'cycling', foot: 'walking' }[d.mode]} route between these places.${e.message === 'HTTP 429' ? ' The free routing server is busy, so try again in a moment.' : ''}</div>`;
  }
}

function renderDirMarkers() {
  state.dirMarkers.forEach((m) => m.remove()); state.dirMarkers = [];
  const { from, to } = state.dir;
  if (from && !from.isMe) {
    const el = document.createElement('div'); el.className = 'start-marker';
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([from.lon, from.lat]).addTo(map);
    m.on('dragend', () => dragWaypoint('from', m)); state.dirMarkers.push(m);
  }
  if (to) {
    const el = document.createElement('div'); el.className = 'pin-marker'; el.innerHTML = ICONS.pin + '<span class="pin-shadow"></span>';
    const m = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([to.lon, to.lat]).addTo(map);
    m.on('dragend', () => dragWaypoint('to', m)); state.dirMarkers.push(m);
  }
}
function dragWaypoint(which, marker) {
  const ll = marker.getLngLat();
  const wp = { label: fmtCoord(ll.lat, ll.lng), lat: ll.lat, lon: ll.lng };
  state.dir[which] = wp; const inp = $(`#dir-${which}`); if (inp) inp.value = wp.label;
  labelWaypoint(which, wp); route();
}

/** Draw routes. With animate=true the active route "draws itself" from start to end. */
function renderRoutes(animate = false) {
  const src = map.getSource('routes'); if (!src) return;
  const { routes, active, mode } = state.dir;
  cancelAnimationFrame(renderRoutes._raf);
  if (map.getLayer('route-casing')) map.setPaintProperty('route-casing', 'line-opacity', mode === 'foot' ? 0 : 1);
  // Draw alternatives first so the active route sits on top.
  const build = (activeCoords) => routes.map((r, i) => ({
    type: 'Feature', properties: { active: i === active, i, mode },
    geometry: i === active && activeCoords ? { type: 'LineString', coordinates: activeCoords } : r.geometry,
  })).sort((a, b) => a.properties.active - b.properties.active);
  const coords = routes[active]?.geometry.coordinates;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || !coords || coords.length < 3 || reduce) { src.setData({ type: 'FeatureCollection', features: build() }); return; }
  const start = performance.now(), dur = 750;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
    const n = Math.max(2, Math.ceil(e * coords.length));
    src.setData({ type: 'FeatureCollection', features: build(coords.slice(0, n)) });
    if (t < 1) renderRoutes._raf = requestAnimationFrame(step);
  };
  renderRoutes._raf = requestAnimationFrame(step);
}
function clearRoute() {
  state.dir.routes = []; renderRoutes();
  state.dirMarkers.forEach((m) => m.remove()); state.dirMarkers = [];
}
map.on('click', 'route-alt', (e) => { const i = e.features[0]?.properties.i; if (i != null) { state.dir.active = +i; renderRoutes(true); renderDirections(); } });

function renderDirections() {
  const d = state.dir, body = $('#dir-body'); if (!body) return;
  const r = d.routes[d.active];
  const steps = r.legs.flatMap((l) => l.steps);
  body.innerHTML = `
    <div class="routes">
      ${d.routes.map((rt, i) => `
        <div class="route-card ${i === d.active ? 'active' : ''}" data-i="${i}">
          <div class="rc-icon">${ICONS[d.mode]}</div>
          <div class="rc-main"><div class="rc-via">via ${esc(rt.legs[0].summary || 'unnamed roads')}</div>
            <div class="rc-sub">${i === 0 ? 'Fastest route' : `${fmtDur(rt.duration - d.routes[0].duration)} slower`}</div></div>
          <div class="rc-time"><div class="rc-dur">${fmtDur(rt.duration)}</div><div class="rc-dist">${fmtDist(rt.distance)}</div>
            <div class="rc-arrive">Arrive ${new Date(Date.now() + rt.duration * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
        </div>`).join('')}
    </div>
    <button class="steps-toggle" id="steps-toggle">${d.showSteps ? 'Hide' : 'Show'} step-by-step directions</button>
    ${d.showSteps ? `<ol class="steps">${steps.map((s, i) => `
      <li data-i="${i}" style="--i:${i}"><span class="st-icon">${stepIcon(s)}</span><span class="st-text">${esc(stepText(s))}${s.distance ? `<div class="st-dist">${fmtDist(s.distance)}</div>` : ''}</span></li>`).join('')}</ol>` : ''}
    <div class="dir-note">Times are estimates from OpenStreetMap road data and don't include live traffic.</div>`;
  $$('.route-card', body).forEach((c) => c.onclick = () => { if (d.active === +c.dataset.i) return; d.active = +c.dataset.i; renderRoutes(true); renderDirections(); });
  $('#steps-toggle').onclick = () => { d.showSteps = !d.showSteps; renderDirections(); };
  $$('.steps li', body).forEach((li) => li.onclick = () => {
    const s = steps[+li.dataset.i]; map.flyTo({ center: s.maneuver.location, zoom: 17, padding: fitPadding() });
  });
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
function stepText(s) {
  const { type, modifier, exit, bearing_after } = s.maneuver;
  const road = s.name || s.ref || '';
  const onto = road ? ` onto ${road}` : '';
  const mod = (modifier || '').replace('slight ', 'slightly ').replace('sharp ', 'sharply ');
  switch (type) {
    case 'depart': return `Head ${COMPASS[Math.round(bearing_after / 45) % 8]}${road ? ` on ${road}` : ''}`;
    case 'arrive': return `Arrive at your destination${modifier && modifier !== 'straight' ? `, on the ${modifier.replace(/slight |sharp /, '')}` : ''}`;
    case 'turn': case 'end of road': return modifier === 'uturn' ? `Make a U-turn${onto}` : `Turn ${mod}${onto}`;
    case 'continue': return modifier === 'uturn' ? `Make a U-turn${onto}` : `Continue ${mod === 'straight' ? 'straight' : mod}${onto}`;
    case 'new name': return `Continue${onto}`;
    case 'merge': return `Merge ${mod}${onto}`;
    case 'on ramp': return `Take the ramp${onto}`;
    case 'off ramp': return `Take the exit${s.destinations ? ` toward ${s.destinations}` : onto}`;
    case 'fork': return `Keep ${mod.replace('slightly ', '')} at the fork${onto}`;
    case 'roundabout': case 'rotary': return `At the roundabout, take the ${ORD[(exit || 1) - 1] || exit + 'th'} exit${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    default: return `${type[0].toUpperCase() + type.slice(1)} ${mod}${onto}`.replace(/\s+/g, ' ');
  }
}
function stepIcon(s) {
  const { type, modifier } = s.maneuver;
  if (type === 'depart') return '🚩';
  if (type === 'arrive') return '📍';
  if (type.includes('roundabout') || type === 'rotary') return '⟳';
  return { left: '←', right: '→', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↙', 'sharp right': '↘', uturn: '↶', straight: '↑' }[modifier] || '↑';
}

$('#directions-btn').onclick = () => openDirections(state.place ? { to: placeToWaypoint(state.place) } : {});

/* ---------------- Geolocation ---------------- */
function locate(silent = false) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('Location is not supported in this browser'); return resolve(null); }
    $('#locate-btn').classList.add('active', 'locating');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('#locate-btn').classList.remove('locating');
      state.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      if (!state.meMarker) { const el = document.createElement('div'); el.className = 'me-marker'; el.title = 'Your location'; state.meMarker = new maplibregl.Marker({ element: el }); }
      state.meMarker.setLngLat([state.me.lon, state.me.lat]).addTo(map);
      if (!silent) map.flyTo({ center: [state.me.lon, state.me.lat], zoom: Math.max(map.getZoom(), 15), padding: fitPadding() });
      resolve(state.me);
    }, (err) => {
      $('#locate-btn').classList.remove('active', 'locating');
      toast(err.code === 1 ? 'Location permission denied' : "Couldn't get your location");
      resolve(null);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}
$('#locate-btn').onclick = () => locate();
$('#zoom-in').onclick = () => map.zoomIn();
$('#zoom-out').onclick = () => map.zoomOut();

/* ---------------- Layers ---------------- */
$('#layer-btn').onclick = (e) => { e.stopPropagation(); $('#layer-menu').classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!$('#layers').contains(e.target)) $('#layer-menu').classList.add('hidden'); });
$$('.layer-opt').forEach((b) => b.addEventListener('click', () => setStyle(b.dataset.style)));
function setStyle(key) {
  if (key === state.styleKey) return;
  state.styleKey = key; localStorage.setItem('map.style', key);
  document.body.classList.add('style-switching');
  map.setStyle(CONFIG.styles[key]);
  map.once('idle', () => document.body.classList.remove('style-switching'));
  setTimeout(() => document.body.classList.remove('style-switching'), 2500);
  applyStyleUI(); $('#layer-menu').classList.add('hidden');
}
function applyStyleUI() {
  $$('.layer-opt').forEach((b) => b.classList.toggle('active', b.dataset.style === state.styleKey));
  // The thumbnail previews the layer you'd switch to, like Google Maps.
  const next = state.styleKey === 'satellite' ? 'liberty' : 'satellite';
  $('#layer-thumb').className = `thumb t-${next}`;
  document.body.classList.toggle('dark-ui', state.styleKey === 'dark');
}

/* ---------------- Drawer ---------------- */
const openDrawer = () => { $('#drawer').classList.add('open'); $('#drawer-backdrop').classList.remove('hidden'); };
const closeDrawer = () => { $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.add('hidden'); };
$('#menu-btn').onclick = openDrawer;
$('#drawer-backdrop').onclick = closeDrawer;
$$('.drawer-item[data-action]').forEach((b) => b.addEventListener('click', () => {
  closeDrawer();
  const a = b.dataset.action;
  if (a === 'saved') showSaved();
  else if (a === 'share') copy(location.href, 'Map link copied');
  else if (a === 'theme') setStyle(state.styleKey === 'dark' ? 'liberty' : 'dark');
}));
function showSaved() {
  if (!state.saved.length) { openPanel(`<div class="results-head">Saved places</div><div class="empty">You haven't saved any places yet. Open a place and tap <b>Save</b>.</div>`); return; }
  showResults(state.saved.map((s) => ({ ...s, tags: {} })), 'Saved places');
}

/* ---------------- Keyboard + URL ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); searchInput.focus(); }
  if (e.key === 'Escape' && document.activeElement.tagName !== 'INPUT') {
    if (state.measure.on) stopMeasure(); else if ($('#drawer').classList.contains('open')) closeDrawer();
    else if (document.body.classList.contains('directions-mode')) closeDirections(); else closePanel();
  }
});

// Support shared links: ?q=Name&ll=lat,lon  or  ?q=search+text
(function handleQueryParams() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q'), ll = params.get('ll');
  if (ll) {
    const [lat, lon] = ll.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const p = { name: q || 'Shared location', category: '', address: '', short: '', lat, lon, tags: {} };
      map.once('load', () => { showPlace(p); if (!location.hash) map.jumpTo({ center: [lon, lat], zoom: 16 }); });
      searchInput.value = p.name; syncClear();
      getJSON(`${CONFIG.photon}/reverse?lat=${lat}&lon=${lon}&limit=1`).then((d) => { const f = d.features[0]; if (f && state.place === p) { const r = photonToPlace(f); p.address = r.address; p.short = r.short; p.category = r.category; showPlace(p); } }).catch(() => {});
    }
  } else if (q) { searchInput.value = q; syncClear(); map.once('load', () => runSearch(q)); }
})();

/* ---------------- Rotating search hints ---------------- */
(function rotatePlaceholder() {
  const hints = ['Search places, addresses, coordinates', 'Try “coffee near me”', 'Try “India Gate”', 'Try “petrol pump”', 'Try “28.6129, 77.2295”'];
  let i = 0;
  setInterval(() => {
    if (document.activeElement === searchInput || searchInput.value || searchInput.placeholder.startsWith('Search nearby')) return;
    searchInput.classList.add('ph-fade');
    setTimeout(() => { i = (i + 1) % hints.length; searchInput.placeholder = hints[i]; searchInput.classList.remove('ph-fade'); }, 300);
  }, 3500);
})();

/* ---------------- Startup: where should the map open? ---------------- */
// Runs after search.js has loaded (it is included after this file).
window.addEventListener('DOMContentLoaded', function initialView() {
  const hasHash = /map=/.test(location.hash);
  const last = JSON.parse(localStorage.getItem('map.view') || 'null');
  if (!hasHash && last) map.jumpTo({ center: last.center, zoom: last.zoom });
  map.on('moveend', debounce(() => {
    localStorage.setItem('map.view', JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() }));
  }, 500));
  // Use GPS silently if the user already allowed it before; otherwise fall back to a rough IP location.
  navigator.permissions?.query({ name: 'geolocation' }).then((perm) => {
    if (perm.state === 'granted') locate(hasHash || last ? true : false);
  }).catch(() => {});
  Search.loadIpLocation().then((ip) => {
    if (ip && !hasHash && !last && !state.me && !new URLSearchParams(location.search).get('ll')) {
      map.flyTo({ center: [ip.lon, ip.lat], zoom: 10, duration: 1500 });
    }
  });
});
