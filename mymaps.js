/* Map: My Maps + saved lists (like Google My Maps).
 * - Draw pins, lines and areas on named maps (layers); edit, reshape, delete; live length / area.
 * - Import GPX, KML and GeoJSON; export a map as GeoJSON, GPX or KML.
 * - Saved lists ("Favourites", "Want to go", "Travel plans" + custom) with a note per place: Lists.pickFor(place).
 * Stored in localStorage under "map.my.*".
 * Uses globals from app.js (map, state, $, $$, esc, mi, toast, debounce, haversine, fmtDist, fmtCoord, openPanel,
 * closePanel, showPlace, persistSaved, fitPadding, clearPlaceMarker, openDirections).
 */
const MyMaps = (() => {
  /* ---------------- Data ---------------- */
  const KEY = { maps: 'map.my.maps', lists: 'map.my.lists', notes: 'map.my.notes' };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const COLORS = ['#ea4335', '#fa7b17', '#fbbc04', '#34a853', '#12b5cb', '#1a73e8', '#a142f4', '#e52592', '#5f6368'];
  const PIN_ICONS = ['location_on', 'star', 'favorite', 'home', 'work', 'restaurant', 'local_cafe', 'hotel', 'park', 'flag', 'photo_camera', 'directions_car'];
  const LABEL = { Point: 'Pin', LineString: 'Line', Polygon: 'Area' };
  const TYPE_ICON = { LineString: 'polyline', Polygon: 'pentagon' };

  const db = load(KEY.maps, { active: null, maps: [] });   // maps: [{ id, name, visible, features: [GeoJSON Feature] }]
  const notes = load(KEY.notes, {});                      // "lat,lon" -> note
  const lists = load(KEY.lists, [
    { id: 'fav', name: 'Favourites', icon: 'favorite', color: '#ea4335', visible: false, places: [] },
    { id: 'want', name: 'Want to go', icon: 'flag', color: '#34a853', visible: false, places: [] },
    { id: 'travel', name: 'Travel plans', icon: 'luggage', color: '#1a73e8', visible: false, places: [] },
  ]);

  function save() {
    try {
      localStorage.setItem(KEY.maps, JSON.stringify(db));
      localStorage.setItem(KEY.lists, JSON.stringify(lists));
      localStorage.setItem(KEY.notes, JSON.stringify(notes));
    } catch { toast('Storage is full: export and delete a map to free space'); }
  }
  const saveSoon = debounce(save, 300);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------------- Geometry ---------------- */
  const feat = (type, coordinates, properties = {}) => ({ type: 'Feature', geometry: { type, coordinates }, properties });
  const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(6), +c[1].toFixed(6)] : c.map(round));
  const okPos = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90;
  const samePos = (a, b) => a[0] === b[0] && a[1] === b[1];
  /** Editable vertices of a feature (polygon rings are returned open). */
  const vertices = (f) => { const g = f.geometry; return g.type === 'Point' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates[0].slice(0, -1) : g.coordinates; };
  function setVertices(f, pts) {
    const g = f.geometry;
    g.coordinates = g.type === 'Polygon' ? [[...pts, pts[0]], ...g.coordinates.slice(1)] : pts;
  }
  const pathLen = (pts) => pts.reduce((d, p, i) => (i ? d + haversine(pts[i - 1], p) : 0), 0);
  /** Area of a lon/lat ring on the sphere, in m². */
  function ringArea(ring) {
    const R = 6378137, r = Math.PI / 180;
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [l1, p1] = ring[i], [l2, p2] = ring[(i + 1) % ring.length];
      s += (l2 - l1) * r * (2 + Math.sin(p1 * r) + Math.sin(p2 * r));
    }
    return Math.abs((s * R * R) / 2);
  }
  const fmtArea = (m2) => (m2 < 1e4 ? `${Math.round(m2).toLocaleString()} m²` : m2 < 1e6 ? `${(m2 / 1e4).toFixed(2)} ha` : `${(m2 / 1e6).toFixed(m2 < 1e8 ? 2 : 0)} km²`);
  const areaText = (ring) => `${fmtArea(ringArea(ring))} · ${fmtDist(pathLen([...ring, ring[0]]))} perimeter`;
  function measure(f) {
    const g = f.geometry;
    if (g.type === 'LineString') return fmtDist(pathLen(g.coordinates));
    if (g.type === 'Polygon') return areaText(vertices(f));
    return fmtCoord(g.coordinates[1], g.coordinates[0]);
  }

  /** Validate coordinates and build one of our features, or null. */
  function makeFeature(type, coords, p = {}) {
    let c = null;
    if (type === 'Point') c = okPos(coords) ? coords : null;
    else if (type === 'LineString') { const l = (coords || []).filter(okPos); c = l.length >= 2 ? l : null; }
    else if (type === 'Polygon') {
      const rings = (coords || []).map((r) => (r || []).filter(okPos)).filter((r) => r.length >= 3).map((r) => (samePos(r[0], r.at(-1)) ? r : [...r, r[0]]));
      c = rings.length && rings[0].length >= 4 ? rings : null;
    }
    if (!c) return null;
    let color = String(p.color || p['marker-color'] || p.stroke || p.fill || '');
    if (/^#[0-9a-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map((h) => h + h).join('');
    return feat(type, round(c), {
      id: uid(), name: String(p.name ?? p.title ?? '').trim() || LABEL[type], note: String(p.note ?? p.description ?? p.desc ?? '').trim(),
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : type === 'Point' ? COLORS[0] : COLORS[5],
      icon: PIN_ICONS.includes(p.icon) ? p.icon : 'location_on',
    });
  }
  /** Any GeoJSON → our features (Multi* geometries are split, collections flattened). */
  function normalize(gj) {
    const out = [];
    const add = (type, c, p) => { const f = makeFeature(type, c, p); if (f) out.push(f); };
    const walk = (g, p) => {
      if (!g) return;
      const c = g.coordinates;
      if (['Point', 'LineString', 'Polygon'].includes(g.type)) add(g.type, c, p);
      else if (g.type === 'MultiPoint') c.forEach((x) => add('Point', x, p));
      else if (g.type === 'MultiLineString') c.forEach((x) => add('LineString', x, p));
      else if (g.type === 'MultiPolygon') c.forEach((x) => add('Polygon', x, p));
      else if (g.type === 'GeometryCollection') g.geometries.forEach((x) => walk(x, p));
    };
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj }];
    (feats || []).forEach((f) => walk(f?.geometry, f?.properties || {}));
    return out;
  }

  /* ---------------- GPX / KML parsing (XML Document → GeoJSON) ---------------- */
  const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
  const txt = (el, name) => kids(el, name)[0]?.textContent.trim() || '';
  const all = (el, name) => [...el.getElementsByTagNameNS('*', name)];
  const stripHtml = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  function gpxToGeoJSON(doc) {
    const root = doc.documentElement, pt = (e) => [+e.getAttribute('lon'), +e.getAttribute('lat')];
    const props = (e) => ({ name: txt(e, 'name'), description: txt(e, 'desc') || txt(e, 'cmt') });
    const features = [
      ...all(doc, 'wpt').map((w) => feat('Point', pt(w), props(w))),
      ...all(doc, 'rte').map((r) => feat('LineString', kids(r, 'rtept').map(pt), props(r))),
      // Each track segment becomes its own line
      ...all(doc, 'trk').flatMap((t) => kids(t, 'trkseg').map((s) => feat('LineString', kids(s, 'trkpt').map(pt), props(t)))),
    ];
    return { type: 'FeatureCollection', name: txt(kids(root, 'metadata')[0], 'name') || txt(root, 'name'), features };
  }

  function kmlToGeoJSON(doc) {
    // KML colours are aabbggrr
    const styleColor = (s) => {
      for (const n of ['LineStyle', 'PolyStyle', 'IconStyle']) {
        const v = txt(all(s, n)[0], 'color');
        if (/^[0-9a-f]{8}$/i.test(v)) return `#${v.slice(6, 8)}${v.slice(4, 6)}${v.slice(2, 4)}`;
      }
      return '';
    };
    const styles = {};
    all(doc, 'Style').forEach((s) => { if (s.id) styles['#' + s.id] = styleColor(s); });
    all(doc, 'StyleMap').forEach((m) => {
      const normal = kids(m, 'Pair').find((p) => txt(p, 'key') === 'normal');
      if (m.id && normal) styles['#' + m.id] = kids(normal, 'Style')[0] ? styleColor(kids(normal, 'Style')[0]) : styles[txt(normal, 'styleUrl')];
    });
    const coords = (el) => (el?.textContent.trim().split(/\s+/) || []).map((s) => s.split(',').map(Number));
    const features = all(doc, 'Placemark').flatMap((pm) => {
      const inline = kids(pm, 'Style')[0];
      const props = { name: txt(pm, 'name'), description: stripHtml(txt(pm, 'description')), color: (inline && styleColor(inline)) || styles[txt(pm, 'styleUrl')] };
      const geoms = [
        ...all(pm, 'Point').map((p) => ['Point', coords(kids(p, 'coordinates')[0])[0]]),
        ...all(pm, 'LineString').map((l) => ['LineString', coords(kids(l, 'coordinates')[0])]),
        ...all(pm, 'Polygon').map((p) => ['Polygon', [...kids(p, 'outerBoundaryIs'), ...kids(p, 'innerBoundaryIs')].map((b) => coords(all(b, 'coordinates')[0]))]),
        ...all(pm, 'Track').map((t) => ['LineString', all(t, 'coord').map((c) => c.textContent.trim().split(/\s+/).map(Number))]), // gx:Track
      ];
      return geoms.map(([type, c]) => feat(type, c, props));
    });
    const root = doc.documentElement;
    return { type: 'FeatureCollection', name: txt(kids(root, 'Document')[0] || kids(root, 'Folder')[0], 'name'), features };
  }

  /** File contents → { name, features }. Throws on unreadable files. */
  function parseFile(text) {
    if (text.trimStart().startsWith('<')) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const kind = doc.documentElement.localName;
      if (doc.getElementsByTagName('parsererror').length || !['gpx', 'kml'].includes(kind)) throw new Error('Not GPX or KML');
      const gj = kind === 'gpx' ? gpxToGeoJSON(doc) : kmlToGeoJSON(doc);
      return { name: gj.name, features: normalize(gj) };
    }
    const gj = JSON.parse(text);
    return { name: gj.name, features: normalize(gj) };
  }

  /* ---------------- Export ---------------- */
  const coordStr = (cs) => cs.map((c) => c.join(',')).join(' ');
  const kmlColor = (hex, alpha) => alpha + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
  const EXPORT = {
    geojson: ['application/geo+json', (m) => JSON.stringify({
      type: 'FeatureCollection', name: m.name,
      features: m.features.map(({ geometry, properties: p }) => ({
        type: 'Feature', geometry,
        // simplestyle-spec colours so other tools (geojson.io, QGIS plugins) pick them up
        properties: { name: p.name, description: p.note, ...(geometry.type === 'Point' ? { 'marker-color': p.color, icon: p.icon } : { stroke: p.color, ...(geometry.type === 'Polygon' && { fill: p.color }) }) },
      })),
    }, null, 2)],
    gpx: ['application/gpx+xml', (m) => {
      const meta = (p) => `<name>${esc(p.name)}</name>${p.note ? `<desc>${esc(p.note)}</desc>` : ''}`;
      const sorted = [...m.features].sort((a, b) => (a.geometry.type === 'Point' ? -1 : 0) - (b.geometry.type === 'Point' ? -1 : 0)); // GPX wants waypoints first
      const body = sorted.map((f) => {
        const g = f.geometry;
        if (g.type === 'Point') return `  <wpt lat="${g.coordinates[1]}" lon="${g.coordinates[0]}">${meta(f.properties)}</wpt>`;
        const pts = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates;
        return `  <trk>${meta(f.properties)}<trkseg>${pts.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk>`;
      });
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Map" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(m.name)}</name></metadata>\n${body.join('\n')}\n</gpx>\n`;
    }],
    kml: ['application/vnd.google-earth.kml+xml', (m) => {
      const body = m.features.map(({ geometry: g, properties: p }) => {
        const geom = g.type === 'Point' ? `<Point><coordinates>${g.coordinates.join(',')}</coordinates></Point>`
          : g.type === 'LineString' ? `<LineString><tessellate>1</tessellate><coordinates>${coordStr(g.coordinates)}</coordinates></LineString>`
          : `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${coordStr(r)}</coordinates></LinearRing></${i ? 'inner' : 'outer'}BoundaryIs>`).join('')}</Polygon>`;
        const style = `<Style><IconStyle><color>${kmlColor(p.color, 'ff')}</color></IconStyle><LineStyle><color>${kmlColor(p.color, 'ff')}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(p.color, '59')}</color></PolyStyle></Style>`;
        return `    <Placemark><name>${esc(p.name)}</name>${p.note ? `<description>${esc(p.note)}</description>` : ''}${style}${geom}</Placemark>`;
      });
      return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><name>${esc(m.name)}</name>\n${body.join('\n')}\n  </Document>\n</kml>\n`;
    }],
  };
  function exportMap(m, fmt) {
    if (!m.features.length) return toast('This map is empty');
    const [type, build] = EXPORT[fmt];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([build(m)], { type }));
    a.download = `${m.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'map'}.${fmt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- Maps ---------------- */
  function createMap(name, features = []) {
    const m = { id: uid(), name, visible: true, features };
    db.maps.push(m); db.active = m.id;
    return m;
  }
  const activeMap = () => db.maps.find((m) => m.id === db.active) || createMap('Untitled map');
  function findFeature(id) {
    for (const m of db.maps) { const f = m.features.find((x) => x.properties.id === id); if (f) return { m, f }; }
    return null;
  }
  function addFeature(type, coords) {
    const m = activeMap(), n = m.features.filter((f) => f.geometry.type === type).length + 1;
    const f = makeFeature(type, coords, { name: `${LABEL[type]} ${n}` });
    m.visible = true; m.features.push(f); save();
    return f;
  }
  function deleteFeature(id) {
    const r = findFeature(id);
    if (!r) return;
    r.m.features = r.m.features.filter((f) => f !== r.f);
    save(); select(null); showHome({ animate: false }); toast(`Deleted “${r.f.properties.name}”`);
  }
  function fitCoords(cs) {
    if (!cs.length) return;
    const b = new maplibregl.LngLatBounds(cs[0], cs[0]);
    cs.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: fitPadding(), maxZoom: 16, duration: 900 });
  }

  /* ---------------- Map rendering ---------------- */
  let open = false, mode = 'select', sel = null, draft = [], hover = null, drag = null;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const setData = (id, features) => map.getSource(id)?.setData({ type: 'FeatureCollection', features });
  const visibleFeatures = () => db.maps.filter((m) => m.visible).flatMap((m) => m.features);
  const isTrue = (k) => ['boolean', ['get', k], false];

  function ensureLayers() {
    for (const id of ['my-data', 'my-draft', 'my-edit']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const add = (l) => { if (!map.getLayer(l.id)) map.addLayer(l); };
    const shapes = ['!=', ['geometry-type'], 'Point'], polys = ['==', ['geometry-type'], 'Polygon'], layout = { 'line-cap': 'round', 'line-join': 'round' };
    add({ id: 'my-fill', type: 'fill', source: 'my-data', filter: polys, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', isTrue('_sel'), 0.35, 0.2] } });
    add({ id: 'my-casing', type: 'line', source: 'my-data', filter: shapes, layout, paint: { 'line-color': '#fff', 'line-opacity': 0.85, 'line-width': ['case', isTrue('_sel'), 9, 5.5] } });
    add({ id: 'my-line', type: 'line', source: 'my-data', filter: shapes, layout, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', isTrue('_sel'), 5, 3] } });
    add({ id: 'my-draft-fill', type: 'fill', source: 'my-draft', filter: polys, paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.15 } });
    add({ id: 'my-draft-line', type: 'line', source: 'my-draft', filter: ['==', ['geometry-type'], 'LineString'], layout, paint: { 'line-color': '#1a73e8', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
    add({ id: 'my-draft-pt', type: 'circle', source: 'my-draft', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['case', isTrue('first'), 6.5, 4.5], 'circle-color': '#fff', 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2 } });
    add({ id: 'my-edit-pt', type: 'circle', source: 'my-edit',
      paint: { 'circle-radius': ['case', isTrue('mid'), coarse ? 7 : 4, coarse ? 11 : 6.5], 'circle-color': '#fff', 'circle-opacity': ['case', isTrue('mid'), 0.75, 1], 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2 } });
  }

  function renderShapes() {
    setData('my-data', visibleFeatures().filter((f) => f.geometry.type !== 'Point').map((f) => ({ ...f, properties: { ...f.properties, _sel: f.properties.id === sel } })));
    // Vertex + midpoint handles for reshaping the selected line/area
    const f = open && mode === 'select' && findFeature(sel)?.f, handles = [];
    if (f && f.geometry.type !== 'Point') {
      const pts = vertices(f), closed = f.geometry.type === 'Polygon';
      pts.forEach((c, i) => handles.push(feat('Point', c, { i })));
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        handles.push(feat('Point', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { i: i + 1, mid: true }));
      }
    }
    setData('my-edit', handles);
  }

  // Pins are DOM markers (icon font, easy dragging); diffed so they don't flicker on every change.
  const pins = new Map();
  function renderPins() {
    const want = new Map(visibleFeatures().filter((f) => f.geometry.type === 'Point').map((f) => [f.properties.id, f]));
    for (const [id, mk] of pins) if (!want.has(id)) { mk.remove(); pins.delete(id); }
    for (const [id, f] of want) {
      let mk = pins.get(id);
      if (!mk) {
        const el = document.createElement('div');
        el.className = 'mm-pin';
        el.innerHTML = '<div class="mm-pin-in"><svg viewBox="0 0 30 40"><path d="M15 1.5C7.5 1.5 1.5 7.5 1.5 15c0 9.8 13.5 23.5 13.5 23.5S28.5 24.8 28.5 15C28.5 7.5 22.5 1.5 15 1.5z"/></svg><span class="mi fill"></span></div>';
        el.addEventListener('click', (e) => { e.stopPropagation(); select(id, { panel: true }); });
        mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates).addTo(map);
        mk.on('dragend', () => {
          const r = findFeature(id);
          if (r) { r.f.geometry.coordinates = round(mk.getLngLat().toArray()); save(); if (sel === id) showEditor({ animate: false }); }
        });
        pins.set(id, mk);
      }
      const p = f.properties, el = mk.getElement();
      el.classList.toggle('sel', id === sel);
      el.style.setProperty('--c', p.color);
      el.title = p.name;
      el.querySelector('.mi').textContent = p.icon;
      mk.setLngLat(f.geometry.coordinates).setDraggable(open);
    }
  }
  const render = () => { renderShapes(); renderPins(); };

  map.on('style.load', () => { ensureLayers(); renderShapes(); renderDraft(); });
  if (map.isStyleLoaded()) ensureLayers();

  /* ---------------- Drawing ---------------- */
  const drawing = () => mode === 'line' || mode === 'area';
  const minPts = () => (mode === 'area' ? 3 : 2);
  const draftCoords = () => (hover && draft.length ? [...draft, hover] : draft);

  function renderDraft() {
    const cs = draftCoords(), feats = draft.map((c, i) => feat('Point', c, { first: i === 0 && mode === 'area' }));
    if (mode === 'area' && cs.length >= 3) feats.unshift(feat('Polygon', [[...cs, cs[0]]]), feat('LineString', [...cs, cs[0]]));
    else if (cs.length >= 2) feats.unshift(feat('LineString', cs));
    setData('my-draft', feats);
    hint();
  }

  function hint() {
    const el = $('#mm-hint'), cs = draftCoords();
    const live = mode === 'line' && cs.length >= 2 ? fmtDist(pathLen(cs)) : mode === 'area' && cs.length >= 3 ? areaText(cs) : mode === 'area' && cs.length === 2 ? fmtDist(pathLen(cs)) : '';
    const tip = {
      select: sel ? (findFeature(sel)?.f.geometry.type === 'Point' ? 'Drag the pin to move it' : 'Drag the dots to reshape · Delete to remove') : 'Click a pin, line or area to edit it',
      pin: 'Click the map to drop a pin',
      line: draft.length ? `Double-click, Enter or tap the last point to finish · Esc to cancel` : 'Click to start a line',
      area: draft.length ? `Click the first point, double-click or press Enter to close · Esc to cancel` : 'Click to start an area',
    }[mode];
    el.innerHTML = (live ? `<b>${esc(live)}</b>` : '') + esc(tip);
    $('#mm-bar [data-act="undo"]').disabled = !(drawing() && draft.length);
    $('#mm-bar [data-act="finish"]').disabled = !(drawing() && draft.length >= minPts());
  }

  function setMode(m) {
    mode = m; draft = []; hover = null;
    const draw = m !== 'select';
    document.body.classList.toggle('mm-draw', draw);
    map.getCanvas().style.cursor = draw ? 'crosshair' : '';
    if (draw) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (draw) { select(null); if (innerWidth <= 640) closePanel(); } // keep the map visible on phones
    $$('#mm-bar [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    renderShapes(); renderDraft();
  }

  function addPoint(e) {
    const near = (c) => c && map.project(c).dist(e.point) < (coarse ? 22 : 12);
    // Clicking the last point (the 2nd click of a double-click) or the first point of an area finishes it.
    if (draft.length >= minPts() && (near(draft.at(-1)) || (mode === 'area' && near(draft[0])))) return finish();
    if (near(draft.at(-1))) return;
    draft.push(round(e.lngLat.toArray()));
    renderDraft();
  }
  function undo() { draft.pop(); renderDraft(); }
  function finish() {
    if (draft.length < minPts()) return toast(mode === 'area' ? 'An area needs at least 3 points' : 'A line needs at least 2 points');
    const f = addFeature(mode === 'area' ? 'Polygon' : 'LineString', mode === 'area' ? [draft] : draft);
    setMode('select'); select(f.properties.id, { panel: true, focus: true });
  }
  function addPin(lngLat) {
    const f = addFeature('Point', lngLat.toArray());
    setMode('select'); select(f.properties.id, { panel: true, focus: true });
  }

  /** Id of the user's line/area under a screen point (with some slack for fingers). */
  function hit(pt) {
    if (!map.getLayer('my-line')) return null;
    const s = coarse ? 12 : 6;
    return map.queryRenderedFeatures([[pt.x - s, pt.y - s], [pt.x + s, pt.y + s]], { layers: ['my-line', 'my-fill'] })[0]?.properties.id ?? null;
  }
  function select(id, { panel = false, focus = false } = {}) {
    sel = id; render();
    if (open) hint();
    if (id && panel) { clearPlaceMarker(); state.place = null; showEditor({ focus }); }
  }

  map.on('click', (e) => {
    if (open && mode === 'pin') return addPin(e.lngLat);
    if (open && drawing()) return addPoint(e);
    const id = hit(e.point);
    if (id) select(id, { panel: true }); else if (open && sel) select(null);
  });

  // Reshaping: drag a vertex, or drag a midpoint to insert a new vertex.
  function onHandleDown(e) {
    const h = e.features?.[0], r = findFeature(sel);
    if (!h || !r) return;
    e.preventDefault(); // stops the map from panning
    drag = { f: r.f, pts: vertices(r.f).slice(), i: h.properties.i, mid: h.properties.mid, moved: false };
  }
  function onDragMove(e) {
    if (!drag) return false;
    if (drag.mid && !drag.moved) drag.pts.splice(drag.i, 0, null);
    drag.moved = true;
    drag.pts[drag.i] = e.lngLat.toArray();
    setVertices(drag.f, drag.pts); renderShapes();
    return true;
  }
  function onDragEnd() {
    if (!drag) return;
    if (drag.moved) { setVertices(drag.f, round(drag.pts)); save(); renderShapes(); showEditor({ animate: false }); }
    drag = null;
  }
  map.on('mousedown', 'my-edit-pt', onHandleDown);
  map.on('touchstart', 'my-edit-pt', onHandleDown);
  map.on('touchmove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  map.on('touchend', onDragEnd);

  let raf = 0;
  map.on('mousemove', (e) => {
    if (onDragMove(e)) return;
    if (open && drawing()) {
      hover = e.lngLat.toArray();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderDraft(); });
    } else if (mode === 'select') {
      const onHandle = map.getLayer('my-edit-pt') && map.queryRenderedFeatures(e.point, { layers: ['my-edit-pt'] }).length;
      if (onHandle) map.getCanvas().style.cursor = 'move';
      else if (hit(e.point)) map.getCanvas().style.cursor = 'pointer';
    }
  });
  map.getCanvas().addEventListener('mouseleave', () => { if (hover) { hover = null; renderDraft(); } });

  // Capture phase so Esc/Enter/Delete don't also reach the app's own shortcuts.
  window.addEventListener('keydown', (e) => {
    if (!open || $('#mm-pick-back') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const k = e.key;
    if (k === 'Escape') { if (mode !== 'select') setMode('select'); else if (sel) select(null); else close(); }
    else if (k === 'Enter' && drawing()) finish();
    else if ((k === 'Backspace' || (k.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey))) && drawing()) undo();
    else if ((k === 'Delete' || k === 'Backspace') && sel && mode === 'select') deleteFeature(sel);
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  /* ---------------- Toolbar ---------------- */
  document.body.insertAdjacentHTML('beforeend', `
    <div id="mm-bar" class="card hidden" role="toolbar" aria-label="Drawing tools">
      <button class="mm-tool" data-mode="select" title="Select and edit"><span class="mi">arrow_selector_tool</span></button>
      <button class="mm-tool" data-mode="pin" title="Add pin"><span class="mi">add_location_alt</span></button>
      <button class="mm-tool" data-mode="line" title="Draw a line"><span class="mi">polyline</span></button>
      <button class="mm-tool" data-mode="area" title="Draw an area"><span class="mi">pentagon</span></button>
      <span class="mm-sep"></span>
      <button class="mm-tool" data-act="undo" title="Undo last point (Backspace)"><span class="mi">undo</span></button>
      <button class="mm-tool" data-act="finish" title="Finish (Enter)"><span class="mi">check</span></button>
      <span class="mm-sep"></span>
      <button class="mm-tool" data-act="panel" title="Your maps and lists"><span class="mi">layers</span></button>
      <button class="mm-tool" data-act="close" title="Close drawing tools"><span class="mi">close</span></button>
    </div>
    <div id="mm-hint" class="card hidden"></div>`);
  $('#mm-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) return setMode(b.dataset.mode);
    ({ undo, finish, panel: () => showHome(), close })[b.dataset.act]();
  });

  function openTools() {
    open = true;
    document.body.classList.add('drawing', 'mm-open');
    $('#mm-bar').classList.remove('hidden'); $('#mm-hint').classList.remove('hidden');
    setMode('select'); renderPins(); showHome();
  }
  function close() {
    open = false;
    setMode('select'); sel = null; render();
    document.body.classList.remove('drawing', 'mm-open');
    $('#mm-bar').classList.add('hidden'); $('#mm-hint').classList.add('hidden');
  }

  /* ---------------- Panel: maps + lists ---------------- */
  let openList = null;
  const fIcon = (f) => mi(f.geometry.type === 'Point' ? f.properties.icon : TYPE_ICON[f.geometry.type], 'fill');
  const homeShown = () => !!$('#panel-content .mm-home') && !$('#panel').classList.contains('hidden');

  function mapGroup(m) {
    const active = m.id === db.active, n = m.features.length;
    return `<div class="mm-group${active ? ' open' : ''}" data-map="${m.id}">
      <div class="mm-row">
        <button class="mm-vis${m.visible ? ' on' : ''}" data-a="vis" title="${m.visible ? 'Hide' : 'Show'} on map" aria-pressed="${m.visible}">${mi(m.visible ? 'visibility' : 'visibility_off')}</button>
        <div class="mm-main" data-a="activate"><div class="mm-name">${esc(m.name)}</div><div class="mm-sub">${n} item${n === 1 ? '' : 's'}${active ? ' · new drawings go here' : ''}</div></div>
      </div>
      ${active ? `<div class="mm-body">
        <input class="mm-input" data-rename="map" value="${esc(m.name)}" aria-label="Map name" />
        <div class="mm-actions">
          <button class="btn" data-a="export" data-fmt="geojson">${mi('download')} GeoJSON</button>
          <button class="btn" data-a="export" data-fmt="gpx">GPX</button>
          <button class="btn" data-a="export" data-fmt="kml">KML</button>
          <button class="btn danger" data-a="del-map">${mi('delete')} Delete</button>
        </div>
        ${n ? m.features.map((f) => `<div class="result mm-item" data-a="feature" data-f="${f.properties.id}">
          <span class="mm-ficon" style="--c:${f.properties.color}">${fIcon(f)}</span>
          <div class="r-main"><div class="r-name">${esc(f.properties.name)}</div><div class="r-sub">${esc(measure(f))}</div></div></div>`).join('')
          : '<div class="mm-empty">Nothing here yet. Use the tools at the top to add pins, lines and areas.</div>'}
      </div>` : ''}
    </div>`;
  }
  function listGroup(l) {
    const expanded = l.id === openList, n = l.places.length;
    return `<div class="mm-group${expanded ? ' open' : ''}" data-list="${l.id}">
      <div class="mm-row">
        <button class="mm-vis${l.visible ? ' on' : ''}" data-a="list-vis" title="${l.visible ? 'Hide' : 'Show'} on map" aria-pressed="${l.visible}">${mi(l.visible ? 'visibility' : 'visibility_off')}</button>
        <span class="mm-ficon" style="--c:${l.color}">${mi(l.icon, 'fill')}</span>
        <div class="mm-main" data-a="list-open"><div class="mm-name">${esc(l.name)}</div><div class="mm-sub">${n} place${n === 1 ? '' : 's'}</div></div>
        <span class="mi mm-chev">expand_more</span>
      </div>
      ${expanded ? `<div class="mm-body">
        <input class="mm-input" data-rename="list" value="${esc(l.name)}" aria-label="List name" />
        ${l.custom ? `<div class="mm-actions"><button class="btn danger" data-a="del-list">${mi('delete')} Delete list</button></div>` : ''}
        ${n ? l.places.map((p, i) => `<div class="result mm-item" data-a="place" data-i="${i}">
          <div class="r-main"><div class="r-name">${esc(p.name)}</div><div class="r-sub">${esc(noteOf(p) || p.short || p.category || '')}</div></div>
          <button class="icon-btn" data-a="unlist" data-i="${i}" title="Remove from list" aria-label="Remove from list">${mi('close')}</button></div>`).join('')
          : '<div class="mm-empty">No places yet. Open a place and tap <b>Save</b>.</div>'}
      </div>` : ''}
    </div>`;
  }

  function showHome({ animate = true } = {}) {
    openPanel(`<div class="mm mm-home">
      <div class="mm-top"><h2>My Maps</h2>
        <button class="icon-btn" data-a="new-map" title="New map" aria-label="New map">${mi('add')}</button>
        <button class="icon-btn" data-a="import" title="Import GPX, KML or GeoJSON" aria-label="Import">${mi('upload')}</button>
        ${open ? '' : `<button class="icon-btn" data-a="tools" title="Drawing tools" aria-label="Drawing tools">${mi('edit')}</button>`}
      </div>
      <div class="mm-sec">Maps</div>
      ${db.maps.map(mapGroup).join('') || '<div class="mm-empty">No maps yet. Pick a tool at the top and click the map to start drawing, or import a GPX, KML or GeoJSON file.</div>'}
      <div class="mm-sec">Saved lists <button data-a="new-list">${mi('add')} New list</button></div>
      ${lists.map(listGroup).join('')}
    </div>`, { animate, keepScroll: !animate });
    const root = $('#panel-content .mm-home');
    root.addEventListener('click', onHomeClick);
    root.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      const g = inp.closest('.mm-group'), obj = inp.dataset.rename === 'map' ? db.maps.find((m) => m.id === g.dataset.map) : lists.find((l) => l.id === g.dataset.list);
      obj.name = inp.value.trim() || 'Untitled';
      g.querySelector('.mm-name').textContent = obj.name;
      saveSoon();
    });
  }

  function onHomeClick(e) {
    const t = e.target.closest('[data-a]');
    if (!t) return;
    const m = db.maps.find((x) => x.id === t.closest('[data-map]')?.dataset.map);
    const l = lists.find((x) => x.id === t.closest('[data-list]')?.dataset.list);
    const refresh = () => { save(); showHome({ animate: false }); };
    ({
      'new-map': () => { createMap('Untitled map'); refresh(); $('#panel [data-rename="map"]')?.select(); },
      import: importFile,
      tools: openTools,
      vis: () => { m.visible = !m.visible; if (!m.visible && findFeature(sel)?.m === m) sel = null; render(); refresh(); },
      activate: () => { db.active = m.id; m.visible = true; render(); refresh(); fitCoords(m.features.flatMap(vertices)); },
      export: () => exportMap(m, t.dataset.fmt),
      'del-map': () => {
        if (!confirm(`Delete “${m.name}” and its ${m.features.length} item(s)?`)) return;
        db.maps.splice(db.maps.indexOf(m), 1);
        if (db.active === m.id) db.active = db.maps[0]?.id ?? null;
        if (!findFeature(sel)) sel = null;
        render(); refresh();
      },
      feature: () => { const r = findFeature(t.dataset.f); r.m.visible = true; select(r.f.properties.id, { panel: true }); flyToFeature(r.f); },
      'new-list': () => { const nl = createList('New list'); openList = nl.id; refresh(); $('#panel [data-rename="list"]')?.select(); },
      'list-vis': () => { l.visible = !l.visible; renderListMarkers(); refresh(); if (l.visible) fitCoords(l.places.map((p) => [p.lon, p.lat])); },
      'list-open': () => { openList = openList === l.id ? null : l.id; refresh(); },
      'del-list': () => {
        if (!confirm(`Delete the list “${l.name}”?`)) return;
        lists.splice(lists.indexOf(l), 1);
        l.places.forEach(syncSaved); renderListMarkers(); refresh();
      },
      place: () => showPlace({ ...l.places[+t.dataset.i], tags: {} }, { fly: true }),
      unlist: () => { const [p] = l.places.splice(+t.dataset.i, 1); syncSaved(p); renderListMarkers(); refresh(); },
    })[t.dataset.a]?.();
  }

  function flyToFeature(f) {
    if (f.geometry.type === 'Point') map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15), padding: fitPadding(), duration: 900 });
    else fitCoords(vertices(f));
  }

  function showEditor({ focus = false, animate = true } = {}) {
    const r = findFeature(sel);
    if (!r) return showHome();
    const { f, m } = r, p = f.properties, type = f.geometry.type;
    openPanel(`<div class="mm mm-editor">
      <div class="mm-top"><button class="icon-btn" data-a="back" title="Back to My Maps" aria-label="Back">${mi('arrow_back')}</button><h2>${LABEL[type]}</h2><span class="mm-sub">in ${esc(m.name)}</span></div>
      <label class="mm-field">Title<input class="mm-input" data-k="name" value="${esc(p.name)}" /></label>
      <label class="mm-field">Note<textarea class="mm-input" data-k="note" rows="3" placeholder="Add a description">${esc(p.note)}</textarea></label>
      <div class="mm-measure"><span class="mm-ficon" style="--c:${p.color}">${fIcon(f)}</span>${esc(measure(f))}</div>
      <div class="mm-label">Colour</div>
      <div class="mm-swatches">${COLORS.map((c) => `<button class="mm-sw${c === p.color ? ' on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      ${type === 'Point' ? `<div class="mm-label">Icon</div>
      <div class="mm-icons" style="--c:${p.color}">${PIN_ICONS.map((i) => `<button class="mm-ic${i === p.icon ? ' on' : ''}" data-icon="${i}" title="${i.replace(/_/g, ' ')}">${mi(i, 'fill')}</button>`).join('')}</div>` : ''}
      <div class="mm-actions">
        <button class="btn" data-a="zoom">${mi('zoom_in')} Zoom to</button>
        ${type === 'Point' ? `<button class="btn" data-a="dir">${mi('directions')} Directions</button>` : ''}
        <button class="btn danger" data-a="delete">${mi('delete')} Delete</button>
        <button class="btn primary" data-a="done">Done</button>
      </div>
      ${open ? '' : '<p class="mm-tip">Open <b>My Maps</b> from the menu to move or reshape this.</p>'}
    </div>`, { animate, keepScroll: !animate });
    const root = $('#panel-content .mm-editor');
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      p[k] = k === 'name' ? e.target.value.trim() || LABEL[type] : e.target.value;
      saveSoon(); renderPins();
    });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.color) { p.color = t.dataset.color; save(); render(); showEditor({ animate: false }); }
      else if (t.dataset.icon) { p.icon = t.dataset.icon; save(); render(); showEditor({ animate: false }); }
      else ({
        back: () => { select(null); showHome(); },
        done: () => { select(null); showHome(); },
        zoom: () => flyToFeature(f),
        dir: () => openDirections({ to: { label: p.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] } }),
        delete: () => deleteFeature(p.id),
      })[t.dataset.a]?.();
    });
    if (focus && !coarse) root.querySelector('[data-k="name"]').select();
  }

  function importFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json,application/json';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const { name, features } = parseFile(await file.text());
        if (!features.length) return toast('No points, lines or areas found in that file');
        createMap(String(name || '').trim() || file.name.replace(/\.[^.]+$/, ''), features);
        save(); render(); showHome();
        fitCoords(features.flatMap(vertices));
        toast(`Imported ${features.length} item${features.length === 1 ? '' : 's'}`);
      } catch { toast("Couldn't read that file. Use GPX, KML or GeoJSON (KMZ isn't supported)."); }
    };
    inp.click();
  }

  /* ---------------- Saved lists ---------------- */
  const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
  const pkey = (p) => `${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}`;
  const noteOf = (p) => notes[pkey(p)] || '';
  const inList = (l, p) => l.places.some((q) => same(q, p));
  const inAny = (p) => lists.some((l) => inList(l, p));
  const snap = (p) => ({ name: p.name, category: p.category || '', address: p.address || '', short: p.short || '', lat: p.lat, lon: p.lon, value: p.value, type: p.type, osm: p.osm });
  function createList(name) {
    const l = { id: uid(), name, icon: 'bookmark', color: COLORS[(lists.length * 2 + 1) % COLORS.length], visible: false, places: [], custom: true };
    lists.push(l);
    return l;
  }
  /** Keep the app's "saved" list in step: a place is saved exactly when it's in at least one list. */
  function syncSaved(p) {
    const i = state.saved.findIndex((s) => same(s, p));
    if (inAny(p) && i < 0) state.saved.unshift({ ...snap(p), tags: {} });
    else if (!inAny(p) && i >= 0) { state.saved.splice(i, 1); delete notes[pkey(p)]; }
    persistSaved(); save();
  }
  // Places saved before lists existed (or imported elsewhere) go into Favourites.
  const fav = lists.find((l) => l.id === 'fav') || lists[0];
  state.saved.forEach((s) => { if (fav && !inAny(s)) fav.places.push(snap(s)); });
  save();

  let listMarkers = [];
  function renderListMarkers() {
    listMarkers.forEach((mk) => mk.remove());
    listMarkers = lists.filter((l) => l.visible).flatMap((l) => l.places.map((p) => {
      const el = document.createElement('div');
      el.className = 'mm-dot'; el.style.setProperty('--c', l.color);
      el.title = [p.name, noteOf(p)].filter(Boolean).join(' — ');
      el.innerHTML = mi(l.icon, 'fill');
      el.addEventListener('click', (e) => { e.stopPropagation(); showPlace({ ...p, tags: {} }); });
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    }));
  }

  /** Small dialog to add/remove `place` to/from lists and edit its note. `onChange` runs after every change. */
  function pickFor(place, onChange) {
    $('#mm-pick-back')?.remove();
    const back = document.createElement('div');
    back.id = 'mm-pick-back';
    const rows = () => lists.map((l) => `<label class="mm-pick-row">
        <input type="checkbox" data-id="${l.id}"${inList(l, place) ? ' checked' : ''} />
        <span class="mm-ficon" style="--c:${l.color}">${mi(l.icon, 'fill')}</span>
        <span class="mm-pick-name">${esc(l.name)}</span><span class="mm-sub">${l.places.length}</span>
        <span class="mi mm-check">check</span></label>`).join('');
    back.innerHTML = `<div id="mm-pick" class="card" role="dialog" aria-modal="true" aria-label="Save to list">
      <div class="mm-pick-head"><div class="mm-main"><div class="mm-name">Save to list</div><div class="mm-sub">${esc(place.name)}</div></div>
        <button class="icon-btn" data-a="close" aria-label="Close">${mi('close')}</button></div>
      <div class="mm-pick-lists">${rows()}</div>
      <button class="mm-pick-new" data-a="new">${mi('add')} New list</button>
      <textarea class="mm-input mm-pick-note" rows="2" placeholder="Add a note">${esc(noteOf(place))}</textarea>
      <div class="mm-pick-foot"><button class="btn primary" data-a="close">Done</button></div>
    </div>`;
    document.body.appendChild(back);
    const changed = () => {
      syncSaved(place); renderListMarkers(); onChange?.();
      if (homeShown()) showHome({ animate: false });
    };
    const shut = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); shut(); } };
    document.addEventListener('keydown', onKey, true);

    back.addEventListener('change', (e) => {
      const l = lists.find((x) => x.id === e.target.dataset.id);
      if (!l) return;
      if (e.target.checked) l.places.unshift(snap(place)); else l.places = l.places.filter((q) => !same(q, place));
      e.target.closest('label').querySelector('.mm-sub').textContent = l.places.length;
      changed();
      toast(e.target.checked ? `Saved to ${l.name}` : `Removed from ${l.name}`);
    });
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-a="close"]')) return shut();
      const nb = e.target.closest('[data-a="new"]');
      if (!nb) return;
      nb.outerHTML = '<input class="mm-input mm-pick-newname" placeholder="List name, then Enter" maxlength="60" />';
      const inp = $('.mm-pick-newname', back);
      inp.focus();
      inp.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || !inp.value.trim()) return;
        createList(inp.value.trim()).places.unshift(snap(place));
        $('.mm-pick-lists', back).innerHTML = rows();
        inp.value = '';
        changed();
      });
    });
    $('.mm-pick-note', back).addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (v) notes[pkey(place)] = v; else delete notes[pkey(place)];
      saveSoon();
    });
  }

  /* ---------------- Drawer entry + startup ---------------- */
  $('#drawer .drawer-foot').insertAdjacentHTML('beforebegin', '<button class="drawer-item" data-x="mymaps"><span class="mi">map</span>My Maps</button>');
  $('#drawer [data-x="mymaps"]').addEventListener('click', () => {
    $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.add('hidden');
    openTools();
  });
  renderPins(); renderListMarkers();

  return { open: openTools, close, lists: { pickFor } };
})();
/** Saved lists API, e.g. Lists.pickFor(place, () => rerenderCard()) from the place card's Save button. */
const Lists = MyMaps.lists;
