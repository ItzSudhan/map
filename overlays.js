/* Map: extra overlay layers ("Map details" toggles in the Layers menu).
 *   Weather radar  RainViewer (animated, past ~2 h)
 *   Cycling        CyclOSM lite overlay (OpenStreetMap France)
 *   Railways       OpenRailwayMap
 *   Hiking/cycling routes  Waymarked Trails
 *   Wikipedia      geotagged articles in view (en.wikipedia.org geosearch)
 * Each toggle is remembered in localStorage (map.ov.<id>) and re-applied after base-style changes.
 * Uses globals from app.js (map, state, $, esc, mi, toast, debounce, getJSON, showPlace).
 */
(() => {
  const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const RASTERS = {
    cycle: { label: 'Cycling', icon: mi('directions_bike'), maxzoom: 20,
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png`),
      attribution: `<a href="https://www.cyclosm.org">CyclOSM</a> hosted by <a href="https://openstreetmap.fr">OSM France</a> · ${OSM}` },
    rail: { label: 'Railways', icon: mi('train'), maxzoom: 19,
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`),
      attribution: `<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC BY-SA) · ${OSM}` },
    hiking: { label: 'Hiking routes', icon: mi('hiking'), maxzoom: 18,
      tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
      attribution: `<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (CC BY-SA) · ${OSM}` },
    bikeroutes: { label: 'Cycle routes', icon: mi('route'), maxzoom: 18,
      tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
      attribution: `<a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a> (CC BY-SA) · ${OSM}` },
  };
  const TOGGLES = [
    ['radar', 'Weather radar', mi('rainy')],
    ...Object.entries(RASTERS).map(([id, r]) => [id, r.label, r.icon]),
    ['wiki', 'Wikipedia places', mi('menu_book')],
  ];
  const on = Object.fromEntries(TOGGLES.map(([id]) => [id, localStorage.getItem(`map.ov.${id}`) === '1']));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const firstSymbolId = () => map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  const removeLayer = (id) => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); };

  /* ---------------- Plain raster overlays ---------------- */
  function applyRaster(id) {
    const lid = `ov-${id}`, r = RASTERS[id];
    if (!on[id]) return removeLayer(lid);
    if (map.getLayer(lid)) return;
    map.addSource(lid, { type: 'raster', tiles: r.tiles, tileSize: 256, maxzoom: r.maxzoom, attribution: r.attribution });
    map.addLayer({ id: lid, type: 'raster', source: lid, paint: { 'raster-opacity': 0.9 } }, firstSymbolId());
  }

  /* ---------------- Weather radar (RainViewer) ---------------- */
  // One layer per frame, all loaded up front; playback just swaps which one is opaque.
  const RADAR_OPACITY = 0.7;
  const radar = { host: '', frames: [], idx: 0, timer: null, refresh: null, el: null };
  const frameId = (f) => `ov-radar-${f.time}`;

  async function loadRadarFrames() {
    try {
      const d = await getJSON('https://api.rainviewer.com/public/weather-maps.json');
      radar.host = d.host;
      radar.frames = [...(d.radar?.past || []), ...(d.radar?.nowcast || [])];
      radar.idx = radar.frames.length - 1;
    } catch { toast('Weather radar is unavailable right now'); radar.frames = []; }
  }
  function clearRadarLayers() {
    map.getStyle().layers.filter((l) => l.id.startsWith('ov-radar-')).forEach((l) => removeLayer(l.id));
  }
  function addRadarLayers() {
    clearRadarLayers();
    const before = firstSymbolId();
    radar.frames.forEach((f, i) => {
      const id = frameId(f);
      // Free API serves zoom 0–7 only; MapLibre over-zooms beyond that. Colour scheme 2, smoothed, with snow.
      map.addSource(id, { type: 'raster', tiles: [`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: 7,
        attribution: 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>' });
      map.addLayer({ id, type: 'raster', source: id,
        paint: { 'raster-opacity': i === radar.idx ? RADAR_OPACITY : 0, 'raster-fade-duration': 0 } }, before);
    });
  }
  function showFrame(i) {
    const prev = radar.frames[radar.idx], next = radar.frames[i];
    if (!next) return;
    if (prev && map.getLayer(frameId(prev))) map.setPaintProperty(frameId(prev), 'raster-opacity', 0);
    if (map.getLayer(frameId(next))) map.setPaintProperty(frameId(next), 'raster-opacity', RADAR_OPACITY);
    radar.idx = i;
    renderTimeline();
  }

  function play(yes) {
    clearTimeout(radar.timer); radar.timer = null;
    if (yes) {
      // Hold a little longer on the latest frame before looping.
      const tick = () => {
        const last = radar.idx === radar.frames.length - 1;
        showFrame(last ? 0 : radar.idx + 1);
        radar.timer = setTimeout(tick, radar.idx === radar.frames.length - 1 ? 1500 : 500);
      };
      radar.timer = setTimeout(tick, 500);
    }
    renderTimeline();
  }

  function timelineEl() {
    if (radar.el) return radar.el;
    const el = document.createElement('div');
    el.id = 'radar-timeline'; el.className = 'card';
    el.innerHTML = `
      <button class="icon-btn rt-play" title="Play" aria-label="Play">${mi('play_arrow', 'fill')}</button>
      <input class="rt-range" type="range" min="0" step="1" aria-label="Radar time">
      <span class="rt-time"></span>
      <a class="rt-src" href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>`;
    $('.rt-play', el).onclick = () => play(!radar.timer);
    $('.rt-range', el).oninput = (e) => { const i = +e.target.value; play(false); showFrame(i); };
    document.body.appendChild(el);
    return (radar.el = el);
  }
  function renderTimeline() {
    const el = radar.el, f = radar.frames[radar.idx];
    if (!el || !f) return;
    const range = $('.rt-range', el);
    range.max = radar.frames.length - 1; range.value = radar.idx;
    const t = new Date(f.time * 1000);
    const ago = Math.round((Date.now() - t) / 60000);
    $('.rt-time', el).innerHTML = `<b>${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>${ago > 0 ? `${ago} min ago` : 'Forecast'}`;
    const btn = $('.rt-play', el), playing = !!radar.timer;
    btn.innerHTML = playing ? mi('pause', 'fill') : mi('play_arrow', 'fill');
    btn.title = playing ? 'Pause' : 'Play'; btn.setAttribute('aria-label', btn.title);
  }

  async function applyRadar(fresh = false) {
    if (!on.radar) {
      play(false); clearInterval(radar.refresh); radar.refresh = null;
      radar.el?.classList.add('hidden');
      return clearRadarLayers();
    }
    if (fresh || !radar.frames.length) await loadRadarFrames();
    if (!on.radar || !radar.frames.length) return;
    try { addRadarLayers(); } catch { return; } // style still loading: style.load re-applies
    timelineEl().classList.remove('hidden');
    renderTimeline();
    // RainViewer publishes a new frame every 10 minutes.
    radar.refresh ||= setInterval(() => applyRadar(true), 10 * 60 * 1000);
    if (!radar.timer && !reduceMotion) play(true);
  }

  /* ---------------- Wikipedia places ---------------- */
  const WIKI_MIN_ZOOM = 12;
  let wikiAbort = null;
  const wikiData = { type: 'FeatureCollection', features: [] };

  function ensureWikiLayers() {
    if (!map.getSource('ov-wiki')) map.addSource('ov-wiki', { type: 'geojson', data: wikiData,
      attribution: '<a href="https://en.wikipedia.org/">Wikipedia</a> (CC BY-SA)' });
    if (map.getLayer('ov-wiki-dot')) return;
    // No beforeId: these sit above labels so they stay clickable.
    map.addLayer({ id: 'ov-wiki-dot', type: 'circle', source: 'ov-wiki', minzoom: WIKI_MIN_ZOOM,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 7], 'circle-color': '#3a3a3a',
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'ov-wiki-label', type: 'symbol', source: 'ov-wiki', minzoom: 15,
      layout: { 'text-field': ['get', 'title'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1],
        'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true },
      paint: { 'text-color': state.styleKey === 'dark' || state.styleKey === 'satellite' ? '#e8eaed' : '#3a3a3a',
        'text-halo-color': state.styleKey === 'dark' || state.styleKey === 'satellite' ? '#202124' : '#fff', 'text-halo-width': 1.4 } });
  }

  async function refreshWiki() {
    if (!on.wiki || map.getZoom() < WIKI_MIN_ZOOM) return;
    wikiAbort?.abort(); wikiAbort = new AbortController();
    const c = map.getCenter(), b = map.getBounds();
    // Geosearch caps the radius at 10 km; cover the visible area up to that.
    const radius = Math.round(Math.min(10000, Math.max(10, haversine(c.toArray(), b.getNorthEast().toArray()))));
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*'
      + `&generator=geosearch&ggscoord=${c.lat.toFixed(5)}|${c.lng.toFixed(5)}&ggsradius=${radius}&ggslimit=50`
      + '&prop=coordinates|description&colimit=max';
    try {
      const d = await getJSON(url, { signal: wikiAbort.signal });
      wikiData.features = (d.query?.pages || []).filter((p) => p.coordinates?.[0]).map((p) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.coordinates[0].lon, p.coordinates[0].lat] },
        properties: { title: p.title, description: p.description || '' } }));
      map.getSource('ov-wiki')?.setData(wikiData);
    } catch (e) { if (e.name !== 'AbortError') console.warn('Wikipedia places:', e); }
  }

  function applyWiki() {
    if (!on.wiki) {
      wikiAbort?.abort();
      ['ov-wiki-label', 'ov-wiki-dot'].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource('ov-wiki')) map.removeSource('ov-wiki');
      return;
    }
    ensureWikiLayers();
    refreshWiki();
  }
  map.on('moveend', debounce(refreshWiki, 400));

  const otherModeActive = () => state.measure?.on || document.body.classList.contains('sv-mode') || document.body.classList.contains('sv-open');
  map.on('click', 'ov-wiki-dot', (e) => {
    if (otherModeActive()) return;
    const f = e.features[0], [lon, lat] = f.geometry.coordinates, { title, description } = f.properties;
    showPlace({ name: title, category: description || '', address: '', short: '', lat, lon,
      tags: { wikipedia: 'en:' + title }, value: 'attraction' }, { fly: true });
  });
  // Registered after app.js's cursor handler, so this wins when hovering a Wikipedia dot.
  map.on('mousemove', (e) => {
    if (!on.wiki || !map.getLayer('ov-wiki-dot') || otherModeActive()) return;
    if (map.queryRenderedFeatures(e.point, { layers: ['ov-wiki-dot'] }).length) map.getCanvas().style.cursor = 'pointer';
  });

  /* ---------------- Wiring ---------------- */
  function apply(id) {
    try {
      if (id === 'radar') applyRadar().catch(() => {});
      else if (id === 'wiki') applyWiki();
      else applyRaster(id);
    } catch { /* style still loading: style.load will apply it */ }
  }
  // setStyle() wipes custom sources/layers: re-add whatever is switched on.
  map.on('style.load', () => TOGGLES.forEach(([id]) => on[id] && apply(id)));
  TOGGLES.forEach(([id]) => on[id] && apply(id));

  $('#layer-menu .layer-toggles').insertAdjacentHTML('beforeend', TOGGLES.map(([id, label, icon]) =>
    `<label class="lt"><input type="checkbox" id="opt-ov-${id}"${on[id] ? ' checked' : ''}><span class="sw"></span>${icon}${esc(label)}</label>`).join(''));
  TOGGLES.forEach(([id]) => {
    $(`#opt-ov-${id}`).onchange = (e) => {
      on[id] = e.target.checked;
      localStorage.setItem(`map.ov.${id}`, on[id] ? '1' : '0');
      apply(id);
      if (id === 'wiki' && on.wiki && map.getZoom() < WIKI_MIN_ZOOM) toast('Zoom in to see Wikipedia places');
    };
  });

})();
