/* Map: Street View, powered by KartaView (free, open street-level imagery, CC BY-SA 4.0).
 * - Street View button: shows blue coverage lines near the map centre; click anywhere to look around.
 * - Viewer: full-screen photo, step forward/back along the drive, mini-map with your heading.
 * - Place cards get a Street View preview when imagery exists nearby.
 * Uses globals from app.js (map, state, $, esc, mi, toast, getJSON, haversine, fmtDist, debounce, ICONS).
 */
const StreetView = (() => {
  const API = 'https://api.openstreetcam.org/2.0';
  const seqCache = new Map();   // sequenceId -> photos[]
  const seqInfo = new Map();    // sequenceId -> { address }
  let mode = false, current = null, seqPhotos = [], viewerEl = null, meMarker = null, loadingCoverage = false;

  const toPhoto = (r) => ({
    id: r.id, seq: r.sequenceId, idx: +r.sequenceIndex, lat: +(r.matchLat || r.lat), lon: +(r.matchLng || r.lng),
    heading: r.heading != null ? +r.heading : null, date: r.shotDate || r.dateAdded,
    img: r.imageProcUrl || r.fileurlProc, thumb: r.imageThUrl || r.fileurlTh, large: r.imageLthUrl || r.fileurlLTh,
  });

  /** Nearest photo for each drive within `radius` metres (KartaView returns one per drive). */
  async function nearby(lat, lon, radius = 300) {
    const d = await getJSON(`${API}/photo/?lat=${lat}&lng=${lon}&radius=${Math.min(radius, 2000)}&itemsPerPage=50`);
    return (d.result?.data || []).map((r) => ({ ...toPhoto(r), dist: +r.distance }))
      .sort((a, b) => a.dist - b.dist);
  }
  async function sequence(seq) {
    if (seqCache.has(seq)) return seqCache.get(seq);
    const p = (async () => {
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const d = await getJSON(`${API}/photo/?sequenceId=${seq}&itemsPerPage=200&page=${page}`);
        const rows = d.result?.data || [];
        all.push(...rows.map(toPhoto));
        if (!d.result?.hasMoreData || rows.length < 200) break;
      }
      return all.sort((a, b) => a.idx - b.idx);
    })();
    seqCache.set(seq, p);
    return p;
  }
  async function info(seq) {
    if (!seqInfo.has(seq)) seqInfo.set(seq, getJSON(`${API}/sequence/${seq}`).then((d) => d.result?.data || {}).catch(() => ({})));
    return seqInfo.get(seq);
  }

  /* ---------------- Coverage layer ---------------- */
  function ensureLayers() {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource('x-sv')) map.addSource('x-sv', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getLayer('x-sv-line')) {
      map.addLayer({ id: 'x-sv-line', type: 'line', source: 'x-sv', filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: mode ? 'visible' : 'none' },
        paint: { 'line-color': '#4285f4', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 8], 'line-opacity': 0.75 } });
      map.addLayer({ id: 'x-sv-dot', type: 'circle', source: 'x-sv', filter: ['==', ['geometry-type'], 'Point'], minzoom: 16,
        layout: { visibility: mode ? 'visible' : 'none' },
        paint: { 'circle-radius': 4, 'circle-color': '#4285f4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    }
  }
  map.on('style.load', () => { ensureLayers(); if (mode) refreshCoverage(); });
  if (map.isStyleLoaded()) ensureLayers();

  async function refreshCoverage() {
    if (!mode || loadingCoverage) return;
    if (map.getZoom() < 12) { toast('Zoom in to see Street View coverage'); return; }
    loadingCoverage = true;
    $('#sv-btn')?.classList.add('loading');
    try {
      const c = map.getCenter();
      const hits = await nearby(c.lat, c.lng, 2000);
      const seqs = [...new Set(hits.map((h) => h.seq))].slice(0, 12);
      const lists = await Promise.all(seqs.map((s) => sequence(s).catch(() => [])));
      const features = [];
      for (const ph of lists) {
        if (ph.length > 1) features.push({ type: 'Feature', properties: { seq: ph[0].seq }, geometry: { type: 'LineString', coordinates: ph.map((p) => [p.lon, p.lat]) } });
        for (const p of ph) features.push({ type: 'Feature', properties: { seq: p.seq, idx: p.idx }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      }
      ensureLayers();
      map.getSource('x-sv')?.setData({ type: 'FeatureCollection', features });
      if (!features.length) toast('No Street View imagery near here yet');
    } catch { toast("Couldn't load Street View coverage"); }
    finally { loadingCoverage = false; $('#sv-btn')?.classList.remove('loading'); }
  }
  const debouncedRefresh = debounce(refreshCoverage, 600);
  map.on('moveend', () => { if (mode && !current) debouncedRefresh(); });

  function setMode(on) {
    mode = on;
    document.body.classList.toggle('sv-mode', on);
    $('#sv-btn').classList.toggle('on', on);
    ensureLayers();
    ['x-sv-line', 'x-sv-dot'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    if (on) { toast('Street View: click a blue line or anywhere on the map'); refreshCoverage(); }
  }

  // Clicking the map in Street View mode opens imagery at that spot.
  map.on('click', async (e) => {
    if (!mode || current) return;
    e.preventDefault?.();
    const f = map.queryRenderedFeatures(e.point, { layers: ['x-sv-dot', 'x-sv-line'].filter((l) => map.getLayer(l)) })[0];
    if (f?.properties?.idx != null) {
      const list = await sequence(f.properties.seq);
      const ph = list.find((p) => p.idx === f.properties.idx);
      if (ph) return open(ph);
    }
    openAt(e.lngLat.lat, e.lngLat.lng);
  });

  async function openAt(lat, lon, radius = 400) {
    toast('Looking for Street View…', 1500);
    try {
      const hits = await nearby(lat, lon, radius);
      if (!hits.length) return toast('No Street View imagery here yet. Try a main road.');
      const list = await sequence(hits[0].seq);
      // Pick the photo in that drive closest to where you clicked
      const best = list.reduce((b, p) => (haversine([lon, lat], [p.lon, p.lat]) < haversine([lon, lat], [b.lon, b.lat]) ? p : b), list[0] || hits[0]);
      open(best);
    } catch { toast("Couldn't reach the Street View service"); }
  }

  /* ---------------- Viewer ---------------- */
  function build() {
    viewerEl = document.createElement('div');
    viewerEl.id = 'sv-viewer';
    viewerEl.className = 'hidden';
    viewerEl.innerHTML = `
      <div class="sv-stage"><img class="sv-img" alt="Street-level photo"><div class="sv-spin"><div class="spinner"></div></div></div>
      <div class="sv-top card"><button class="icon-btn sv-close" aria-label="Close Street View">${mi('arrow_back')}</button>
        <div class="sv-title"><div class="sv-addr">Street View</div><div class="sv-date"></div></div></div>
      <button class="sv-nav sv-prev" aria-label="Step back">${mi('arrow_back_ios_new')}</button>
      <button class="sv-nav sv-next" aria-label="Step forward">${mi('arrow_forward_ios')}</button>
      <div class="sv-bottom"><span class="sv-count"></span>
        <a class="sv-credit" target="_blank" rel="noopener" href="https://kartaview.org">Imagery © KartaView contributors, CC BY-SA 4.0</a></div>`;
    document.body.appendChild(viewerEl);
    viewerEl.querySelector('.sv-close').onclick = close;
    viewerEl.querySelector('.sv-prev').onclick = () => step(-1);
    viewerEl.querySelector('.sv-next').onclick = () => step(1);
    let tx = null;
    viewerEl.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
    viewerEl.addEventListener('touchend', (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null; });
    document.addEventListener('keydown', (e) => {
      if (!current) return;
      if (e.key === 'Escape') { close(); e.stopPropagation(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { step(1); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { step(-1); e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  async function open(photo) {
    if (!viewerEl) build();
    const wasOpen = !!current;
    current = photo;
    viewerEl.classList.remove('hidden');
    document.body.classList.add('sv-open');
    if (!wasOpen) setTimeout(() => map.resize(), 320);
    show();
    seqPhotos = await sequence(photo.seq).catch(() => [photo]);
    if (current !== photo) return;
    current = seqPhotos.find((p) => p.idx === photo.idx) || photo;
    updateNav();
    info(photo.seq).then((s) => {
      if (current?.seq !== photo.seq) return;
      const addr = (s.address || '').split(',').slice(0, 2).join(',').trim();
      viewerEl.querySelector('.sv-addr').textContent = addr || 'Street View';
    });
  }
  function show() {
    const p = current, img = viewerEl.querySelector('.sv-img');
    viewerEl.classList.add('loading');
    img.classList.remove('loaded');
    const src = p.img || p.large;
    const pre = new Image();
    pre.onload = () => { if (current !== p) return; img.src = src; img.classList.add('loaded'); viewerEl.classList.remove('loading'); };
    pre.onerror = () => { if (current === p) { viewerEl.classList.remove('loading'); toast("This photo couldn't be loaded"); } };
    pre.src = src;
    const d = p.date ? new Date(p.date.replace(' ', 'T')) : null;
    viewerEl.querySelector('.sv-date').textContent = d && !isNaN(d) ? `Captured ${d.toLocaleDateString([], { month: 'short', year: 'numeric' })}` : '';
    // Mini-map: marker with a heading cone, kept centred
    if (!meMarker) {
      const el = document.createElement('div'); el.className = 'sv-me';
      el.innerHTML = '<div class="sv-cone"></div><div class="sv-dot"></div>';
      meMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' });
    }
    meMarker.setLngLat([p.lon, p.lat]).setRotation(p.heading || 0).addTo(map);
    map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 17), duration: 500 });
    updateNav();
    // Preload neighbours for instant stepping
    [1, -1].forEach((d) => { const n = neighbour(d); if (n) new Image().src = n.img || n.large; });
  }
  function neighbour(d) { const i = seqPhotos.findIndex((p) => p.idx === current?.idx); return i < 0 ? null : seqPhotos[i + d]; }
  function updateNav() {
    const i = seqPhotos.findIndex((p) => p.idx === current?.idx);
    viewerEl.querySelector('.sv-prev').classList.toggle('disabled', i <= 0);
    viewerEl.querySelector('.sv-next').classList.toggle('disabled', i < 0 || i >= seqPhotos.length - 1);
    viewerEl.querySelector('.sv-count').textContent = i >= 0 && seqPhotos.length > 1 ? `${i + 1} / ${seqPhotos.length}` : '';
  }
  function step(d) { const n = neighbour(d); if (n) { current = n; show(); } }
  function close() {
    if (!current) return;
    current = null;
    viewerEl.classList.add('hidden');
    document.body.classList.remove('sv-open');
    meMarker?.remove();
    setTimeout(() => map.resize(), 50);
  }
  // While the viewer is open, clicking the mini-map jumps there.
  map.on('click', (e) => { if (current) openAt(e.lngLat.lat, e.lngLat.lng, 200); });

  /* ---------------- Controls + entry points ---------------- */
  $('#controls').insertAdjacentHTML('afterbegin', `<button id="sv-btn" class="ctrl round" title="Street View" aria-label="Street View">${mi('streetview')}</button>`);
  $('#sv-btn').onclick = () => setMode(!mode);

  /** Place-card preview (called from app.js renderPlace). */
  async function preview(p) {
    const el = document.getElementById('pe-streetview');
    if (!el) return;
    try {
      const hits = await nearby(p.lat, p.lon, ['city', 'town', 'state', 'country'].includes(p.value) ? 1500 : 250);
      if (!hits.length || state.place !== p || !document.contains(el)) return;
      const ph = hits[0];
      el.innerHTML = `<button class="sv-card" aria-label="Open Street View">
        <img src="${esc(ph.thumb || ph.img)}" alt="" loading="lazy" onload="this.classList.add('loaded')">
        <span class="sv-card-label">${mi('streetview')} Street View <small>${ph.dist ? fmtDist(ph.dist) + ' away' : ''}</small></span></button>`;
      el.querySelector('button').onclick = async () => { const list = await sequence(ph.seq); open(list.find((x) => x.idx === ph.idx) || ph); };
    } catch {}
  }

  return { open, openAt, close, preview, setMode, get active() { return !!current; } };
})();
