/* Map: power tools.
 * Isochrones ("How far can I go?", Valhalla on FOSSGIS), route elevation profiles (Open-Meteo),
 * map image download / print, QR codes + share sheet, voice search, "Report a map problem" (OSM notes),
 * coordinate formats (DD, DMS, UTM, geohash) and distance rings. All services are free with no API key.
 * Uses globals from app.js (map, state, $, $$, esc, mi, toast, copy, debounce, getJSON, haversine, fmtDist, fmtCoord, fitPadding).
 */
const Tools = (() => {
  const VALHALLA = 'https://valhalla1.openstreetmap.de/isochrone';
  const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
  const OSM_NOTES = 'https://api.openstreetmap.org/api/0.6/notes.json';
  const empty = () => ({ type: 'FeatureCollection', features: [] });

  /* =========================================================
     QR code encoder: byte mode, error correction M, versions 1–10
     (algorithm after Project Nayuki's MIT-licensed reference)
     ========================================================= */
  const QR_ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];  // EC codewords per block, level M
  const QR_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];         // number of blocks, level M
  const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  function rsDivisor(deg) {
    const r = Array(deg).fill(0); r[deg - 1] = 1;
    for (let i = 0, root = 1; i < deg; i++, root = gfMul(root, 2))
      for (let j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  // Modules available for data + EC after function patterns, per version.
  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const totalCodewords = (v) => Math.floor(rawModules(v) / 8);
  const dataCodewords = (v) => totalCodewords(v) - QR_ECC[v - 1] * QR_BLOCKS[v - 1];

  /** Encode text into a QR module matrix (rows of booleans, true = dark). */
  function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let v = 1;
    while (v <= 10 && dataCodewords(v) * 8 < 4 + (v < 10 ? 8 : 16) + bytes.length * 8) v++;
    if (v > 10) throw new Error('Text too long for a QR code');

    // Data bits: mode, length, payload, terminator, padding
    const cap = dataCodewords(v) * 8, bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // Split into blocks, add Reed–Solomon EC, interleave
    const nb = QR_BLOCKS[v - 1], ecLen = QR_ECC[v - 1], total = totalCodewords(v);
    const nShort = nb - (total % nb), shortLen = Math.floor(total / nb), div = rsDivisor(ecLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, (k += shortLen - ecLen + (i < nShort ? 0 : 1)));
      blocks.push([d, rsRemainder(d, div)]);
    }
    const out = [];
    for (let i = 0; i <= shortLen - ecLen; i++) for (const [d] of blocks) if (i < d.length) out.push(d[i]);
    for (let i = 0; i < ecLen; i++) for (const [, e] of blocks) out.push(e[i]);

    // Function patterns
    const size = 17 + 4 * v;
    const mod = Array.from({ length: size }, () => Array(size).fill(false));
    const fn = Array.from({ length: size }, () => Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    const bit = (n, i) => ((n >>> i) & 1) === 1;
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach((ay, i) => pos.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return; // finder corners
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const drawFormat = (mask) => {
      const d = mask; // EC level M = 0b00
      let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
      set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
      set(8, size - 8, true); // dark module
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
    }

    // Codewords in the zigzag order, skipping function modules
    for (let right = size - 1, i = 0; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < out.length * 8) { mod[y][x] = bit(out[i >>> 3], 7 - (i & 7)); i++; }
      }
    }

    // Pick the mask with the lowest penalty
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      const lines = [...mod, ...mod.map((_, x) => mod.map((row) => row[x]))];
      for (const line of lines) {
        for (let i = 1, run = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
        const s = line.map(Number).join('');
        for (const pat of ['10111010000', '00001011101']) for (let k = s.indexOf(pat); k >= 0; k = s.indexOf(pat, k + 1)) p += 40;
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      }
      return p + (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(); if (p < bestP) { bestP = p; best = m; }
      applyMask(m); // XOR again to undo
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  /** QR code for `text` as an SVG string (black on white, 4-module quiet zone). */
  function qr(text) {
    const m = qrMatrix(text), b = 4, n = m.length + b * 2;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + b} ${y + b}h1v1h-1z`; }));
    return `<svg class="qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  /* =========================================================
     Coordinate formats
     ========================================================= */
  function dms(lat, lon) {
    const part = (v, pos, neg) => {
      const t = Math.round(Math.abs(v) * 36000); // tenths of a second, so 59.95" rounds up cleanly
      const d = Math.floor(t / 36000), m = Math.floor((t % 36000) / 600), s = (t % 600) / 10;
      return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v < 0 && t ? neg : pos}`;
    };
    return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
  }
  /** WGS84 → UTM (zone, band, easting, northing). Not defined beyond 84°N / 80°S (polar UPS). */
  function utm(lat, lon) {
    if (lat < -80 || lat > 84) return null;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    let zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;               // Norway
    if (lat >= 72 && lon >= 0 && lon < 42) zone = lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : 37; // Svalbard
    const band = 'CDEFGHJKLMNPQRSTUVWX'[Math.min(19, Math.floor((lat + 80) / 8))];
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
    const phi = lat * r, sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    const N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos;
    const A = cos * (lon - ((zone - 1) * 6 - 177)) * r;
    const e4 = e2 * e2, e6 = e4 * e2;
    const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
      + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
    const easting = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
    let northing = k0 * (M + N * tan * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    if (lat < 0) northing += 1e7;
    return { zone, band, easting, northing };
  }
  function geohash(lat, lon, precision = 9) {
    const B32 = '0123456789bcdefghjkmnpqrstuvwxyz', la = [-90, 90], lo = [-180, 180];
    let out = '', idx = 0, n = 0, even = true;
    while (out.length < precision) {
      const rng = even ? lo : la, v = even ? lon : lat, mid = (rng[0] + rng[1]) / 2;
      idx = idx * 2 + (v >= mid ? 1 : 0); rng[v >= mid ? 0 : 1] = mid;
      even = !even;
      if (++n === 5) { out += B32[idx]; idx = 0; n = 0; }
    }
    return out;
  }
  /** All coordinate formats for a point. */
  function coordFormats(lat, lon) {
    const u = utm(lat, lon);
    return {
      dd: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      dms: dms(lat, lon),
      utm: u ? `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}` : 'Not available near the poles',
      geohash: geohash(lat, lon),
    };
  }

  /* =========================================================
     UI helpers: modal, floating tool cards, map layers
     ========================================================= */
  function modal(title, html) {
    let m = $('#tools-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'tools-modal'; m.className = 'hidden';
      m.innerHTML = '<div class="modal-card card" role="dialog" aria-modal="true"><div class="modal-head"><h2></h2><button class="icon-btn modal-x" aria-label="Close"><span class="mi">close</span></button></div><div class="modal-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.modal-x')) m.classList.add('hidden'); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) { m.classList.add('hidden'); e.stopPropagation(); } }, true);
    }
    m.querySelector('h2').textContent = title;
    m.querySelector('.modal-body').innerHTML = html;
    m.classList.remove('hidden');
    return m;
  }

  const cards = document.createElement('div'); cards.id = 'tool-cards'; document.body.appendChild(cards);
  /** Floating card with a title and a close (clear) button; returns its body element. */
  function toolCard(id, icon, title, onClose) {
    let c = $(`#${id}`);
    if (!c) {
      c = document.createElement('div'); c.id = id; c.className = 'tool-card card';
      c.innerHTML = `<div class="tc-head"><span class="mi">${icon}</span><b>${esc(title)}</b><button class="icon-btn tc-x" title="Clear" aria-label="Clear"><span class="mi">close</span></button></div><div class="tc-body"></div>`;
      c.querySelector('.tc-x').onclick = () => { c.remove(); onClose(); };
      cards.appendChild(c);
    }
    return c.querySelector('.tc-body');
  }
  function originMarker(old, lat, lon) {
    old?.remove();
    const el = document.createElement('div'); el.className = 'tool-origin';
    return new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  }
  const bboxOf = (rings) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.flat().forEach(([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); });
    return [[b[0], b[1]], [b[2], b[3]]];
  };

  // Our map layers; data kept here so we can restore it after a base-style switch.
  const layerData = { 'x-iso': empty(), 'x-rings': empty() };
  function ensureLayers() {
    for (const [id, data] of Object.entries(layerData)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
    const before = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const add = (l, under) => { if (!map.getLayer(l.id)) map.addLayer(l, under ? before : undefined); };
    add({ id: 'x-iso-fill', type: 'fill', source: 'x-iso', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } }, true);
    add({ id: 'x-iso-line', type: 'line', source: 'x-iso', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.9 } }, true);
    add({ id: 'x-rings-line', type: 'line', source: 'x-rings', filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#1a73e8', 'line-width': 2, 'line-dasharray': [3, 2] } });
    add({ id: 'x-rings-label', type: 'symbol', source: 'x-rings', filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#1a73e8', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
  }
  function setData(id, data) { layerData[id] = data; map.getSource(id)?.setData(data); }
  map.on('style.load', ensureLayers);
  if (map.isStyleLoaded()) ensureLayers();

  /* =========================================================
     1. Isochrones: "How far can I go?"
     ========================================================= */
  const ISO_MODES = { car: ['auto', 'directions_car', 'Drive'], bike: ['bicycle', 'directions_bike', 'Cycle'], walk: ['pedestrian', 'directions_walk', 'Walk'] };
  const ISO_TIMES = { 15: [5, 10, 15], 30: [10, 20, 30], 60: [20, 40, 60] };
  const ISO_COLORS = ['#34a853', '#fbbc04', '#ea4335']; // nearest → farthest
  const iso = { lat: 0, lon: 0, mode: 'car', max: 30, marker: null, ctrl: null };

  function isochrone(lat, lon) {
    Object.assign(iso, { lat, lon });
    iso.marker = originMarker(iso.marker, lat, lon);
    const body = toolCard('iso-card', 'timer', 'How far can I go?', clearIsochrone);
    body.innerHTML = `
      <div class="seg" data-k="mode">${Object.entries(ISO_MODES).map(([k, [, icon, label]]) => `<button data-v="${k}" title="${label}" aria-label="${label}"><span class="mi">${icon}</span></button>`).join('')}</div>
      <div class="seg" data-k="max">${Object.keys(ISO_TIMES).map((t) => `<button data-v="${t}">${t < 60 ? `${t} min` : '1 hr'}</button>`).join('')}</div>
      <div class="tc-legend"></div>`;
    $$('.seg', body).forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      iso[seg.dataset.k] = seg.dataset.k === 'max' ? +b.dataset.v : b.dataset.v;
      loadIsochrone(body);
    }));
    loadIsochrone(body, true);
  }
  async function loadIsochrone(body, fit = false) {
    $$('.seg button', body).forEach((b) => b.classList.toggle('active', b.dataset.v === String(iso[b.parentElement.dataset.k])));
    const legend = $('.tc-legend', body), times = ISO_TIMES[iso.max];
    legend.innerHTML = '<div class="tc-status"><div class="spinner"></div>Calculating…</div>';
    iso.ctrl?.abort();
    const ctrl = (iso.ctrl = new AbortController());
    const q = { locations: [{ lat: iso.lat, lon: iso.lon }], costing: ISO_MODES[iso.mode][0], contours: times.map((time) => ({ time })), polygons: true, denoise: 0.5, generalize: 30 };
    try {
      const gj = await getJSON(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(q))}`, { signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(20000)]) });
      // Draw the largest contour first so smaller ones sit on top.
      const feats = gj.features.filter((f) => /Polygon/.test(f.geometry.type)).sort((a, b) => b.properties.contour - a.properties.contour)
        .map((f) => ({ ...f, properties: { contour: f.properties.contour, color: ISO_COLORS[times.indexOf(f.properties.contour)] || ISO_COLORS[2] } }));
      if (ctrl.signal.aborted) return; // superseded or cleared meanwhile
      setData('x-iso', { type: 'FeatureCollection', features: feats });
      legend.innerHTML = times.map((t, i) => `<span><i style="background:${ISO_COLORS[i]}"></i>${t} min</span>`).join('')
        + `<div class="tc-note">${ISO_MODES[iso.mode][2]} time from this point, without traffic</div>`;
      if (fit && feats[0]) {
        const g = feats[0].geometry, rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
        map.fitBounds(bboxOf(rings), { padding: fitPadding(), duration: 800 });
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      legend.innerHTML = '<div class="tc-status">Couldn’t reach the routing server. Try again in a moment.</div>';
    }
  }
  function clearIsochrone() {
    iso.ctrl?.abort(); iso.marker?.remove(); iso.marker = null;
    $('#iso-card')?.remove(); setData('x-iso', empty());
  }

  /* =========================================================
     8. Distance rings
     ========================================================= */
  const ringState = { lat: 0, lon: 0, radii: '1, 5, 10', marker: null };
  function circle(lat, lon, km, n = 96) {
    const R = 6371, d = km / R, r = Math.PI / 180, φ1 = lat * r, λ1 = lon * r, pts = [];
    for (let i = 0; i <= n; i++) {
      const θ = (i / n) * 2 * Math.PI;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
      const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
      pts.push([λ2 / r, φ2 / r]);
    }
    return pts;
  }
  function rings(lat, lon) {
    Object.assign(ringState, { lat, lon });
    ringState.marker = originMarker(ringState.marker, lat, lon);
    const body = toolCard('rings-card', 'track_changes', 'Distance rings', clearRings);
    body.innerHTML = `<label class="tc-field">Radii in km<input type="text" inputmode="decimal" value="${esc(ringState.radii)}" spellcheck="false"></label>`;
    const inp = $('input', body);
    inp.addEventListener('input', debounce(() => { ringState.radii = inp.value; drawRings(); }, 300));
    drawRings(true);
  }
  function drawRings(fit = false) {
    const radii = [...new Set(ringState.radii.split(/[\s,;]+/).map(Number).filter((k) => k > 0 && k <= 5000))].sort((a, b) => a - b);
    const { lat, lon } = ringState, features = [];
    for (const km of radii) {
      const pts = circle(lat, lon, km);
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} });
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pts[0] }, properties: { label: km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m` } });
    }
    setData('x-rings', { type: 'FeatureCollection', features });
    if (fit && radii.length) map.fitBounds(bboxOf([circle(lat, lon, radii.at(-1), 16)]), { padding: fitPadding(), duration: 800 });
  }
  function clearRings() {
    ringState.marker?.remove(); ringState.marker = null;
    $('#rings-card')?.remove(); setData('x-rings', empty());
  }

  /* =========================================================
     2. Route elevation profile
     ========================================================= */
  /** `n` points evenly spaced by distance along a [[lon,lat],...] line, each with its distance `d` in metres. */
  function sampleLine(coords, n) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    const total = cum.at(-1), out = [];
    for (let k = 0, i = 1; k < n; k++) {
      const d = (total * k) / (n - 1);
      while (i < coords.length - 1 && cum[i] < d) i++;
      const seg = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
      const [a, b] = [coords[i - 1], coords[i] || coords[i - 1]];
      out.push({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, d });
    }
    return out;
  }
  let elevDot = null;
  function moveElevDot(p) {
    if (!p) { elevDot?.remove(); elevDot = null; return; }
    if (!elevDot) { const el = document.createElement('div'); el.className = 'elev-dot'; elevDot = new maplibregl.Marker({ element: el }); }
    elevDot.setLngLat([p.lon, p.lat]).addTo(map);
  }

  /** Render an elevation chart for a route into `container`. Resolves to { ascent, descent, min, max } or null on failure. */
  async function elevationProfile(coords, container) {
    const token = (container._elev = Symbol('elev'));
    container.classList.add('elev');
    container.innerHTML = '<div class="tc-status"><div class="spinner"></div>Loading elevation…</div>';
    if (!coords || coords.length < 2) { container.innerHTML = ''; return null; }
    const pts = sampleLine(coords, 100);
    let res;
    try {
      res = await getJSON(`${ELEVATION}?latitude=${pts.map((p) => p.lat.toFixed(5)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(5)).join(',')}`);
    } catch {
      if (container._elev === token) container.innerHTML = '<div class="tc-status">Elevation data unavailable right now.</div>';
      return null;
    }
    if (container._elev !== token) return null; // a newer route replaced this one
    pts.forEach((p, i) => { p.ele = res.elevation[i] ?? 0; });
    let ascent = 0, descent = 0;
    // Sum climbs on a 5-point moving average so DEM noise doesn't inflate the totals.
    const smooth = pts.map((_, i) => { const w = pts.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, p) => a + p.ele, 0) / w.length; });
    for (let i = 1; i < smooth.length; i++) { const dz = smooth[i] - smooth[i - 1]; if (dz > 0) ascent += dz; else descent -= dz; }
    const eles = pts.map((p) => p.ele), min = Math.min(...eles), max = Math.max(...eles);
    container.innerHTML = `
      <div class="elev-sum"><span>${mi('trending_up')}${Math.round(ascent)} m</span><span>${mi('trending_down')}${Math.round(descent)} m</span>
        <span class="muted">Highest ${Math.round(max)} m · Lowest ${Math.round(min)} m</span></div>
      <div class="elev-chart"></div>`;
    drawElevation($('.elev-chart', container), pts, min, max);
    return { ascent, descent, min, max };
  }
  function drawElevation(box, pts, min, max) {
    const H = 130, pad = { l: 42, r: 10, t: 10, b: 22 }, total = pts.at(-1).d;
    // Keep flat routes from looking dramatic: at least a 30 m vertical range.
    const span = Math.max(30, max - min), lo = min - (span - (max - min)) / 2, hi = lo + span;
    let W = 0;
    const draw = () => {
      if (!box.isConnected) return ro.disconnect();
      if (box.clientWidth === W) return;
      W = box.clientWidth || 340;
      const x = (d) => pad.l + (total ? d / total : 0) * (W - pad.l - pad.r), y = (e) => pad.t + ((hi - e) / span) * (H - pad.t - pad.b);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
      const base = H - pad.b;
      const yt = [hi, (hi + lo) / 2, lo].map((e) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(e)}" y2="${y(e)}" class="eg"/><text x="${pad.l - 6}" y="${y(e) + 4}" text-anchor="end">${Math.round(e)} m</text>`).join('');
      const xt = [0, 0.5, 1].map((f, i) => `<text x="${x(total * f)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${f ? fmtDist(total * f) : '0'}</text>`).join('');
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Elevation profile">
          ${yt}${xt}<path d="${line}L${x(total)},${base}L${pad.l},${base}Z" class="ea"/><path d="${line}" class="el"/>
          <g class="eh hidden"><line y1="${pad.t}" y2="${base}" /><circle r="4"/></g>
        </svg><div class="elev-tip hidden"></div>`;
      const svg = $('svg', box), hov = $('.eh', svg), tip = $('.elev-tip', box);
      svg.onpointermove = (e) => {
        const r = svg.getBoundingClientRect(), f = ((e.clientX - r.left) * (W / r.width) - pad.l) / (W - pad.l - pad.r);
        const p = pts[Math.round(Math.min(1, Math.max(0, f)) * (pts.length - 1))], px = x(p.d);
        hov.classList.remove('hidden');
        hov.querySelector('line').setAttribute('x1', px); hov.querySelector('line').setAttribute('x2', px);
        hov.querySelector('circle').setAttribute('cx', px); hov.querySelector('circle').setAttribute('cy', y(p.ele));
        tip.classList.remove('hidden'); tip.textContent = `${fmtDist(p.d)} · ${Math.round(p.ele)} m`;
        tip.style.left = `${Math.min(Math.max(px, 50), W - 50)}px`;
        moveElevDot(p);
      };
      svg.onpointerleave = () => { hov.classList.add('hidden'); tip.classList.add('hidden'); moveElevDot(null); };
    };
    const ro = new ResizeObserver(draw);
    ro.observe(box); draw();
  }

  /* =========================================================
     3. Map image download / print
     ========================================================= */
  const PIN = new Path2D('M13.5 1C6.6 1 1 6.6 1 13.5 1 23 13.5 42 13.5 42S26 23 26 13.5C26 6.6 20.4 1 13.5 1z');
  /** Snapshot of the map canvas (+ place pin and an attribution footer). Must read pixels right after a render. */
  function capture() {
    return new Promise((resolve) => {
      map.once('render', () => {
        const src = map.getCanvas(), s = src.width / src.clientWidth, foot = Math.round(30 * s);
        const c = document.createElement('canvas'); c.width = src.width; c.height = src.height + foot;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        // DOM markers aren't part of the WebGL canvas, so paint the place pin ourselves.
        if (state.place) {
          const pt = map.project([state.place.lon, state.place.lat]);
          g.save(); g.translate(pt.x * s - 13.5 * s, pt.y * s - 42 * s); g.scale(s, s);
          g.fillStyle = '#ea4335'; g.strokeStyle = '#a52714'; g.fill(PIN); g.stroke(PIN);
          g.beginPath(); g.arc(13.5, 13.5, 5, 0, 2 * Math.PI); g.fillStyle = '#a52714'; g.fill(); g.restore();
        }
        g.fillStyle = '#fff'; g.fillRect(0, src.height, c.width, foot);
        g.fillStyle = '#5f6368'; g.font = `${12 * s}px Roboto, Arial, sans-serif`; g.textBaseline = 'middle';
        const attrib = ($('.maplibregl-ctrl-attrib-inner')?.textContent || '© OpenStreetMap contributors').replace(/\s+/g, ' ').trim();
        const right = `${location.host || 'Map'} · ${new Date().toLocaleDateString()}`, rw = g.measureText(right).width;
        g.fillText(attrib, 10 * s, src.height + foot / 2, c.width - rw - 40 * s);
        g.textAlign = 'right'; g.fillText(right, c.width - 10 * s, src.height + foot / 2);
        resolve(c);
      });
      map.triggerRepaint();
    });
  }
  async function downloadImage() {
    const c = await capture(), ctr = map.getCenter();
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `map-${ctr.lat.toFixed(4)}_${ctr.lng.toFixed(4)}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Map image downloaded');
    }, 'image/png');
  }
  async function printMap() {
    // Print a snapshot image: WebGL canvases often print blank.
    let sheet = $('#print-sheet');
    if (!sheet) { sheet = document.createElement('div'); sheet.id = 'print-sheet'; sheet.innerHTML = '<img alt="Map">'; document.body.appendChild(sheet); }
    const img = $('img', sheet);
    img.src = (await capture()).toDataURL('image/png');
    await img.decode().catch(() => {});
    document.body.classList.add('printing');
    addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true });
    window.print();
  }

  /* =========================================================
     4. Share sheet with QR code
     ========================================================= */
  function shareSheet({ title = 'Map', url = location.href } = {}) {
    let code = '';
    try { code = qr(url); } catch { /* URL too long for v10: skip the QR */ }
    const t = encodeURIComponent(title), u = encodeURIComponent(url);
    const m = modal('Share', `
      <div class="share-title">${esc(title)}</div>
      <div class="share-link"><input class="code" readonly value="${esc(url)}"><button class="btn primary" data-copy>${mi('content_copy')}Copy</button></div>
      ${code ? `<div class="share-qr">${code}<div class="muted">Scan to open on your phone</div></div>` : ''}
      <div class="share-quick">
        ${navigator.share ? `<button class="btn" data-native>${mi('share')}More…</button>` : ''}
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}">${mi('chat')}WhatsApp</a>
        <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${t}&url=${u}"><b class="x-logo">𝕏</b>Post</a>
        <a class="btn" href="mailto:?subject=${t}&body=${u}">${mi('mail')}Email</a>
      </div>`);
    const inp = $('.share-link input', m);
    inp.onfocus = () => inp.select();
    $('[data-copy]', m).onclick = () => copy(url, 'Link copied');
    const nat = $('[data-native]', m);
    if (nat) nat.onclick = () => navigator.share({ title, url }).catch(() => {});
  }

  /* =========================================================
     6. Report a map problem (anonymous OpenStreetMap note)
     ========================================================= */
  function reportProblem(lat, lon, placeName = '') {
    const osmUrl = `https://www.openstreetmap.org/note/new#map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`;
    const m = modal('Report a map problem', `
      <p class="muted">Describe what's wrong${placeName ? ` with <b>${esc(placeName)}</b>` : ' here'} (${esc(fmtCoord(lat, lon))}). Your note goes to OpenStreetMap volunteers who fix the map. Notes are public and anonymous, so don't include personal details.</p>
      <textarea class="code report-text" rows="5" maxlength="1800" placeholder="e.g. This shop has closed, the road name is misspelled, a new building is missing…"></textarea>
      <div class="modal-actions"><button class="btn primary" data-send>Send report</button><a class="btn" href="${osmUrl}" target="_blank" rel="noopener">Open on OpenStreetMap</a></div>`);
    const ta = $('.report-text', m), send = $('[data-send]', m);
    ta.focus();
    send.onclick = async () => {
      const msg = ta.value.trim();
      if (msg.length < 5) { toast('Please describe the problem'); return ta.focus(); }
      send.disabled = true; send.textContent = 'Sending…';
      const text = `${placeName ? `${placeName}: ` : ''}${msg}\n\n(via ${location.host || 'Map'})`;
      try {
        const res = await fetch(`${OSM_NOTES}?${new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6), text })}`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const id = (await res.json()).properties?.id;
        $('.modal-body', m).innerHTML = `<p>${mi('check_circle', 'fill ok-icon')}Thanks! Your note was sent to OpenStreetMap.</p>
          <div class="modal-actions"><a class="btn primary" href="https://www.openstreetmap.org/note/${id}" target="_blank" rel="noopener">View note #${id}</a></div>`;
      } catch {
        $('.modal-body', m).innerHTML = `<p class="muted">Couldn't send the note directly. You can add it on OpenStreetMap instead (your text is copied).</p>
          <div class="modal-actions"><a class="btn primary" href="${osmUrl}" target="_blank" rel="noopener">Open on OpenStreetMap</a></div>`;
        navigator.clipboard?.writeText(msg).catch(() => {});
      }
    };
  }

  /* =========================================================
     7. Coordinate formats modal
     ========================================================= */
  function showCoordFormats(lat, lon) {
    const f = coordFormats(lat, lon);
    const rows = [['Decimal degrees', f.dd], ['Degrees, minutes, seconds', f.dms], ['UTM', f.utm], ['Geohash', f.geohash]];
    const m = modal('Coordinates', `<div class="coord-list">${rows.map(([k, v], i) => `
      <div class="coord-row"><div><div class="muted">${k}</div><code>${esc(v)}</code></div>
      <button class="icon-btn" data-i="${i}" title="Copy" aria-label="Copy ${k}"><span class="mi">content_copy</span></button></div>`).join('')}</div>`);
    $$('[data-i]', m).forEach((b) => { b.onclick = () => copy(rows[b.dataset.i][1], `${rows[b.dataset.i][0]} copied`); });
  }

  /* =========================================================
     5. Voice search
     ========================================================= */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    $('#search-card .divider').insertAdjacentHTML('beforebegin', '<button id="mic-btn" class="icon-btn" title="Search by voice" aria-label="Search by voice"><span class="mi">mic</span></button>');
    const btn = $('#mic-btn'), input = $('#search-input');
    let rec = null;
    btn.onclick = () => {
      if (rec) return rec.stop();
      rec = new SR();
      rec.lang = navigator.language || 'en-IN';
      rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        input.value = e.results[0][0].transcript;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Microphone access is blocked'); else if (e.error !== 'aborted' && e.error !== 'no-speech') toast("Couldn't hear that, try again"); };
      rec.onend = () => { rec = null; btn.classList.remove('listening'); };
      btn.classList.add('listening');
      rec.start();
    };
  }

  /* =========================================================
     9. Context menu, drawer and place-card entry points
     ========================================================= */
  const ctxMenu = $('#ctx-menu');
  ctxMenu.insertAdjacentHTML('beforeend', `
    <li data-action="iso"><span class="mi">timer</span>How far can I go?</li>
    <li data-action="rings"><span class="mi">track_changes</span>Distance rings</li>
    <li data-action="coords-fmt"><span class="mi">explore</span>Coordinate formats</li>
    <li data-action="report"><span class="mi">flag</span>Report a map problem</li>`);
  ctxMenu.addEventListener('click', (e) => {
    const a = e.target.closest('li')?.dataset.action, ll = state.ctxLngLat;
    const act = { iso: isochrone, rings, 'coords-fmt': showCoordFormats, report: reportProblem }[a];
    if (!act || !ll) return;
    ctxMenu.classList.add('hidden');
    act(ll.lat, ll.lng);
  });

  $('#drawer .drawer-foot').insertAdjacentHTML('beforebegin', `
    <div class="drawer-sep"></div>
    <button class="drawer-item" data-tool="image"><span class="mi">image</span>Download map image</button>
    <button class="drawer-item" data-tool="print"><span class="mi">print</span>Print map</button>`);
  $$('#drawer [data-tool]').forEach((b) => b.addEventListener('click', () => {
    $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.add('hidden');
    (b.dataset.tool === 'image' ? downloadImage : printMap)();
  }));

  /** Add "How far can I go?" and "Report a problem" rows to the open place card. */
  function placeHook(p) {
    const note = $('#panel .attribution-note'); if (!note) return;
    note.insertAdjacentHTML('beforebegin', `
      <div class="info-row" data-tool="iso"><span class="ir-icon">${mi('timer')}</span><span>How far can I go from here?</span></div>
      <div class="info-row" data-tool="report"><span class="ir-icon">${mi('flag')}</span><span>Report a problem with this place</span></div>`);
    $('#panel [data-tool="iso"]').onclick = () => isochrone(p.lat, p.lon);
    $('#panel [data-tool="report"]').onclick = () => reportProblem(p.lat, p.lon, p.name);
  }

  return {
    isochrone, clearIsochrone, rings, clearRings, elevationProfile, downloadImage, printMap,
    qr, shareSheet, reportProblem, coordFormats, showCoordFormats, placeHook,
  };
})();
