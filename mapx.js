/* Map: extra map features.
 * 3D buildings + tilt, terrain (hillshade + 3D relief), globe view, compass, fullscreen,
 * live location tracking, keyboard shortcuts, embed mode, saved-places export/import, installable app (PWA).
 * Uses globals from app.js (map, state, $, $$, esc, toast, copy, locate, openDirections, startMeasure, showSaved, fitPadding, persistSaved).
 */
(() => {
  const opts = {
    terrain: localStorage.getItem('map.terrain') === '1',
    globe: localStorage.getItem('map.globe') !== '0',
    threeD: false,
  };
  const DEM = {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Terrain: Mapzen / AWS Open Data',
  };

  /* ---------------- Controls ---------------- */
  const controls = $('#controls');
  controls.insertAdjacentHTML('afterbegin', `
    <button id="compass-btn" class="ctrl round hidden" title="Reset north (N)" aria-label="Reset north"><svg viewBox="0 0 24 24"><path d="M12 2l4 10h-8z" fill="#ea4335"/><path d="M12 22l-4-10h8z" fill="#9aa0a6"/></svg></button>
    <button id="tilt-btn" class="ctrl round" title="3D view (T)" aria-label="3D view"><span class="mi">view_in_ar</span></button>
    <button id="fs-btn" class="ctrl round" title="Fullscreen (F)" aria-label="Fullscreen"><span class="mi">fullscreen</span></button>`);

  const compass = $('#compass-btn');
  function syncCompass() {
    const b = map.getBearing(), p = map.getPitch();
    compass.classList.toggle('hidden', Math.abs(b) < 0.5 && p < 1);
    compass.querySelector('svg').style.transform = `rotateX(${p * 0.6}deg) rotate(${-b}deg)`;
    $('#tilt-btn').classList.toggle('on', p > 10);
  }
  map.on('rotate', syncCompass); map.on('pitch', syncCompass);
  compass.onclick = () => { opts.threeD = false; map.easeTo({ bearing: 0, pitch: 0, duration: 600 }); };

  $('#tilt-btn').onclick = () => toggle3D();
  function toggle3D(force) {
    opts.threeD = force ?? map.getPitch() < 10;
    if (opts.threeD) {
      ensure3DBuildings();
      map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, zoom: Math.max(map.getZoom(), 15.5), duration: 900 });
    } else map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }

  $('#fs-btn').onclick = toggleFullscreen;
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen not available here'));
  }
  document.addEventListener('fullscreenchange', () => { $('#fs-btn').classList.toggle('on', !!document.fullscreenElement); $('#fs-btn .mi').textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen'; });

  /* ---------------- 3D buildings / terrain / globe ---------------- */
  function firstSymbolId() { return map.getStyle().layers.find((l) => l.type === 'symbol')?.id; }
  function ensure3DBuildings() {
    if (!map.getSource('openmaptiles') || map.getStyle().layers.some((l) => l.type === 'fill-extrusion')) return;
    const dark = state.styleKey === 'dark';
    map.addLayer({
      id: 'x-3d-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': dark ? '#3a3d42' : '#e6e1da',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 8]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    }, firstSymbolId());
  }
  function applyTerrain() {
    if (state.styleKey === 'satellite' && !opts.terrain) { map.setTerrain?.(null); return; }
    if (opts.terrain) {
      if (!map.getSource('x-dem')) map.addSource('x-dem', DEM);
      if (!map.getSource('x-dem-hs')) map.addSource('x-dem-hs', DEM);
      if (!map.getLayer('x-hillshade')) map.addLayer({ id: 'x-hillshade', type: 'hillshade', source: 'x-dem-hs', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': state.styleKey === 'dark' ? '#000' : '#5a4a3a' } }, firstSymbolId());
      map.setTerrain({ source: 'x-dem', exaggeration: 1.4 });
    } else {
      map.setTerrain?.(null);
      if (map.getLayer('x-hillshade')) map.removeLayer('x-hillshade');
    }
  }
  function applyGlobe() { try { map.setProjection({ type: opts.globe ? 'globe' : 'mercator' }); } catch {} }
  function applyAll() { applyGlobe(); applyTerrain(); if (map.getPitch() > 10) ensure3DBuildings(); }
  map.on('style.load', applyAll);
  if (map.isStyleLoaded()) applyAll();

  // Toggles inside the Layers menu
  $('#layer-menu').insertAdjacentHTML('beforeend', `
    <div class="layer-toggles">
      <div class="lt-title">Map details</div>
      <label class="lt"><input type="checkbox" id="opt-terrain"><span class="sw"></span><span class="mi">landscape</span>Terrain</label>
      <label class="lt"><input type="checkbox" id="opt-globe"><span class="sw"></span><span class="mi">public</span>Globe view</label>
      <label class="lt"><input type="checkbox" id="opt-3d"><span class="sw"></span><span class="mi">location_city</span>3D buildings</label>
    </div>`);
  const tTerrain = $('#opt-terrain'), tGlobe = $('#opt-globe'), t3d = $('#opt-3d');
  tTerrain.checked = opts.terrain; tGlobe.checked = opts.globe;
  tTerrain.onchange = () => {
    opts.terrain = tTerrain.checked; localStorage.setItem('map.terrain', opts.terrain ? '1' : '0'); applyTerrain();
    if (opts.terrain && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 900 });
    toast(opts.terrain ? 'Terrain on: drag with right-click or two fingers to tilt' : 'Terrain off');
  };
  tGlobe.onchange = () => { opts.globe = tGlobe.checked; localStorage.setItem('map.globe', opts.globe ? '1' : '0'); applyGlobe(); if (opts.globe) map.easeTo({ zoom: Math.min(map.getZoom(), 2.5), duration: 1200 }); };
  t3d.onchange = () => toggle3D(t3d.checked);
  map.on('pitchend', () => { t3d.checked = map.getPitch() > 10; });
  $('#layer-menu').addEventListener('click', (e) => { if (e.target.closest('.layer-toggles')) e.stopPropagation(); });

  /* ---------------- Live location tracking ---------------- */
  // 1st tap: find me. 2nd tap (while centred on me): follow me as I move. 3rd tap: stop following.
  let watchId = null, following = false;
  const locBtn = $('#locate-btn');
  locBtn.onclick = async () => {
    if (following) return stopFollow();
    const me = state.me;
    const centred = me && haversine([me.lon, me.lat], map.getCenter().toArray()) < 50;
    if (!me || !centred) { await locate(); return; }
    following = true; locBtn.classList.add('following'); locBtn.title = 'Following your location — tap to stop';
    toast('Following your location');
    watchId = navigator.geolocation.watchPosition((pos) => {
      state.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, heading: pos.coords.heading };
      state.meMarker?.setLngLat([state.me.lon, state.me.lat]);
      const el = state.meMarker?.getElement();
      if (el && pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) { el.classList.add('has-heading'); el.style.setProperty('--heading', `${pos.coords.heading}deg`); }
      if (following) map.easeTo({ center: [state.me.lon, state.me.lat], duration: 800 });
    }, () => stopFollow(), { enableHighAccuracy: true, maximumAge: 2000 });
  };
  function stopFollow() {
    following = false; locBtn.classList.remove('following'); locBtn.title = 'Your location';
    if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null;
  }
  map.on('dragstart', () => { if (following) { stopFollow(); toast('Stopped following'); } });

  /* ---------------- Modal helper ---------------- */
  function modal(title, html) {
    let m = $('#modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'modal'; m.className = 'hidden';
      m.innerHTML = '<div class="modal-card card"><div class="modal-head"><h2></h2><button class="icon-btn modal-x" aria-label="Close"><span class="mi">close</span></button></div><div class="modal-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.modal-x')) m.classList.add('hidden'); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) { m.classList.add('hidden'); e.stopPropagation(); } }, true);
    }
    m.querySelector('h2').textContent = title;
    m.querySelector('.modal-body').innerHTML = html;
    m.classList.remove('hidden');
    return m;
  }

  /* ---------------- Keyboard shortcuts ---------------- */
  const SHORTCUTS = [
    ['/', 'Search'], ['D', 'Directions'], ['L', 'Your location'], ['+ / −', 'Zoom in / out'], ['T', '3D view'], ['N', 'Reset north'],
    ['G', 'Globe view'], ['F', 'Fullscreen'], ['M', 'Measure distance'], ['S', 'Saved places'], ['Esc', 'Close panel'], ['?', 'This help'],
  ];
  function showShortcuts() {
    modal('Keyboard shortcuts', `<div class="kbd-grid">${SHORTCUTS.map(([k, l]) => `<kbd>${esc(k)}</kbd><span>${esc(l)}</span>`).join('')}</div>`);
  }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const k = e.key;
    const act = {
      '?': showShortcuts, d: () => openDirections(state.place ? { to: { label: state.place.name, lat: state.place.lat, lon: state.place.lon } } : {}),
      l: () => locBtn.click(), '+': () => map.zoomIn(), '=': () => map.zoomIn(), '-': () => map.zoomOut(), _: () => map.zoomOut(),
      t: () => toggle3D(), n: () => compass.click(), f: toggleFullscreen, m: () => { startMeasure(); toast('Click the map to measure'); },
      g: () => { tGlobe.checked = !tGlobe.checked; tGlobe.onchange(); }, s: () => showSaved(),
    }[k.length === 1 ? k.toLowerCase() : k];
    if (act) { e.preventDefault(); act(); }
  });

  /* ---------------- Drawer additions ---------------- */
  const foot = $('#drawer .drawer-foot');
  foot.insertAdjacentHTML('beforebegin', `
    <div class="drawer-sep"></div>
    <button class="drawer-item" data-x="embed"><span class="mi">code_blocks</span>Embed this map</button>
    <button class="drawer-item" data-x="export"><span class="mi">download</span>Export saved places</button>
    <button class="drawer-item" data-x="import"><span class="mi">upload</span>Import places (GeoJSON)</button>
    <button class="drawer-item" data-x="keys"><span class="mi">keyboard</span>Keyboard shortcuts</button>
    <button class="drawer-item hidden" data-x="install"><span class="mi">install_mobile</span>Install app</button>`);
  $$('#drawer [data-x]').forEach((b) => b.addEventListener('click', () => {
    $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.add('hidden');
    ({ embed: showEmbed, export: exportSaved, import: importSaved, keys: showShortcuts, install: installApp })[b.dataset.x]();
  }));

  function showEmbed() {
    const c = map.getCenter(), z = map.getZoom().toFixed(2);
    const pl = state.place ? `&q=${encodeURIComponent(state.place.name)}&ll=${state.place.lat.toFixed(6)},${state.place.lon.toFixed(6)}` : '';
    const src = `${location.origin}${location.pathname}?embed=1${pl}#map=${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
    const code = `<iframe src="${src}" width="600" height="450" style="border:0;border-radius:12px" loading="lazy" allow="geolocation; fullscreen"></iframe>`;
    const m = modal('Embed this map', `
      <p class="muted">Paste this into any web page. It shows the current view${state.place ? ` with <b>${esc(state.place.name)}</b> pinned` : ''}.</p>
      <textarea class="code" readonly rows="4">${esc(code)}</textarea>
      <div class="modal-actions"><button class="btn primary" data-copy>Copy HTML</button><a class="btn" href="${esc(src)}" target="_blank" rel="noopener">Preview</a></div>
      <iframe class="embed-preview" src="${esc(src)}" loading="lazy"></iframe>`);
    m.querySelector('[data-copy]').onclick = () => copy(code, 'Embed code copied');
  }

  function exportSaved() {
    if (!state.saved.length) return toast('No saved places yet');
    const gj = { type: 'FeatureCollection', features: state.saved.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { name: s.name, category: s.category, address: s.address } })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(gj, null, 2)], { type: 'application/geo+json' }));
    a.download = 'saved-places.geojson'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${state.saved.length} places`);
  }
  function importSaved() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.geojson,.json,application/geo+json,application/json';
    inp.onchange = async () => {
      try {
        const gj = JSON.parse(await inp.files[0].text());
        const feats = (gj.features || []).filter((f) => f.geometry?.type === 'Point');
        let n = 0;
        for (const f of feats) {
          const [lon, lat] = f.geometry.coordinates, pr = f.properties || {};
          if (state.saved.some((s) => Math.abs(s.lat - lat) < 1e-6 && Math.abs(s.lon - lon) < 1e-6)) continue;
          state.saved.push({ name: pr.name || pr.title || 'Imported place', category: pr.category || '', address: pr.address || pr.description || '', short: pr.address || '', lat, lon, tags: {} });
          n++;
        }
        persistSaved(); toast(`Imported ${n} place${n === 1 ? '' : 's'}`); if (n) showSaved();
      } catch { toast("That file isn't valid GeoJSON"); }
    };
    inp.click();
  }

  /* ---------------- Embed mode (?embed=1) ---------------- */
  if (new URLSearchParams(location.search).get('embed') === '1') {
    document.body.classList.add('embed');
    const full = location.href.replace(/[?&]embed=1/, (m) => (m[0] === '?' ? '?' : '')).replace('?&', '?');
    document.body.insertAdjacentHTML('beforeend', `<a id="embed-open" class="card" href="${esc(full)}" target="_blank" rel="noopener">Open in Map ↗</a>`);
  }

  /* ---------------- Installable app (PWA) ---------------- */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#drawer [data-x="install"]').classList.remove('hidden'); });
  function installApp() { installPrompt?.prompt(); installPrompt = null; $('#drawer [data-x="install"]').classList.add('hidden'); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

  syncCompass();
})();
