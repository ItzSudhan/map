/* Map: turn-by-turn navigation (Google-Maps-style).
 * Follows your GPS position along an OSRM route with a tilted, rotating camera, a maneuver banner,
 * voice guidance (Web Speech API), off-route rerouting, arrival detection and a simulated drive for demos.
 * Uses globals from app.js (map, state, CONFIG, $, esc, mi, toast, getJSON, haversine, fmtDist, fmtDur, stepText, stepIcon, fitPadding).
 */

/** Small geometry helpers for [lon, lat] polylines. Distances in metres, bearings in degrees. */
const NavGeo = {
  /** Polyline with cumulative distances, so positions can be expressed as "metres along". */
  line(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    return { coords, cum, total: cum[cum.length - 1] };
  },
  bearing([lon1, lat1], [lon2, lat2]) {
    const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  /** Index of the segment containing `along` (binary search on cumulative distances). */
  segAt(L, along) {
    let lo = 0, hi = L.coords.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L.cum[mid] <= along) lo = mid; else hi = mid - 1; }
    return Math.max(0, lo);
  },
  pointAt(L, along) {
    if (L.coords.length < 2) return L.coords[0];
    const i = NavGeo.segAt(L, along), len = L.cum[i + 1] - L.cum[i];
    const t = len ? Math.min(1, Math.max(0, (along - L.cum[i]) / len)) : 0;
    const [a, b] = [L.coords[i], L.coords[i + 1]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  },
  /** Closest point on the line to p, searching only segments within [lo, hi] metres along.
   *  Returns { point, along, dist } (dist = metres from p to the line). */
  snap(L, p, lo = 0, hi = Infinity) {
    const kx = Math.cos(p[1] * Math.PI / 180) * 111320, ky = 110574; // local flat projection, fine at street scale
    let best = { point: L.coords[0], along: 0, dist: Infinity };
    for (let i = NavGeo.segAt(L, lo); i < L.coords.length - 1 && L.cum[i] <= hi; i++) {
      const a = L.coords[i], b = L.coords[i + 1];
      const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
      const dist = Math.hypot(ax + t * dx, ay + t * dy);
      if (dist < best.dist) best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], along: L.cum[i] + t * (L.cum[i + 1] - L.cum[i]), dist };
    }
    return best;
  },
};

const TurnByTurn = (() => {
  // Voice prompt distances (metres) per travel mode: early warning, final warning, "now".
  const VOICE = { car: [500, 150, 40], bike: [200, 60, 20], foot: [100, 30, 12] };
  const OFF_ROUTE_M = 50, OFF_ROUTE_MS = 4000, PITCH = 55;
  const APP_ROUTE_LAYERS = ['route-alt-casing', 'route-alt', 'route-casing', 'route-line', 'route-line-foot'];
  const ZERO_PAD = { top: 0, bottom: 0, left: 0, right: 0 };
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lcFirst = (s) => s[0].toLowerCase() + s.slice(1);
  let muted = localStorage.getItem('map.nav.mute') === '1';
  let nav = null; // the active session, or null

  /* ---------------- Formatting ---------------- */
  /** Banner distance, rounded like Google: 30 m, 250 m, 1.2 km. */
  const navDist = (m) => (m >= 1000 ? fmtDist(m) : `${m >= 100 ? Math.round(m / 50) * 50 : Math.max(0, Math.round(m / 10) * 10)} m`);
  const spokenDist = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} kilometres` : `${m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10} metres`);
  const clock = (sec) => new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function say(text) {
    if (muted || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = navigator.language || 'en';
    speechSynthesis.speak(u);
  }

  /* ---------------- Route model ---------------- */
  function setRoute(route) {
    const L = NavGeo.line(route.geometry.coordinates);
    const steps = route.legs.flatMap((l) => l.steps);
    // Maneuver positions along our line: OSRM step lengths, scaled to our measured total to avoid drift.
    const sum = steps.reduce((a, s) => a + s.distance, 0) || 1;
    let acc = 0;
    const stepAlong = steps.map((s) => { const v = (acc / sum) * L.total; acc += s.distance; return v; });
    const sufDur = steps.map((_, i) => steps.slice(i).reduce((a, s) => a + s.duration, 0));
    Object.assign(nav, { route, L, steps, stepAlong, sufDur, along: 0, next: Math.min(1, steps.length - 1), spoken: 0, chained: null, offSince: null });
    drawProgress();
  }
  /** Index of the step being travelled at `along` (the maneuver behind you). */
  const stepAt = (along) => { let i = 0; while (i < nav.steps.length - 1 && nav.stepAlong[i + 1] <= along) i++; return i; };

  /* ---------------- Map layers ---------------- */
  function addLayers() {
    if (!nav) return;
    if (!map.getSource('nav-route')) map.addSource('nav-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const color = (done, left) => ['match', ['get', 'part'], 'done', done, left];
    const layout = { 'line-cap': 'round', 'line-join': 'round' };
    if (!map.getLayer('nav-casing')) map.addLayer({ id: 'nav-casing', type: 'line', source: 'nav-route', layout, paint: { 'line-color': color('#80868b', '#1557b0'), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 18] } });
    if (!map.getLayer('nav-line')) map.addLayer({ id: 'nav-line', type: 'line', source: 'nav-route', layout, paint: { 'line-color': color('#bdc1c6', '#4285f4'), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 13] } });
    // The planned-route layers from app.js would show the old route under ours after a reroute.
    APP_ROUTE_LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'));
    drawProgress();
  }
  function removeLayers() {
    ['nav-line', 'nav-casing'].forEach((id) => map.getLayer(id) && map.removeLayer(id));
    if (map.getSource('nav-route')) map.removeSource('nav-route');
    APP_ROUTE_LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'visible'));
  }
  map.on('style.load', addLayers);

  /** Split the route at the current position: travelled part grey, remaining part blue. */
  function drawProgress() {
    const src = map.getSource('nav-route'); if (!src || !nav?.L) return;
    const { L, along } = nav, i = NavGeo.segAt(L, along), here = NavGeo.pointAt(L, along);
    const f = (part, coords) => ({ type: 'Feature', properties: { part }, geometry: { type: 'LineString', coordinates: coords } });
    src.setData({ type: 'FeatureCollection', features: [f('done', [...L.coords.slice(0, i + 1), here]), f('left', [here, ...L.coords.slice(i + 1)])] });
  }

  /* ---------------- UI ---------------- */
  function buildUI() {
    const el = document.createElement('div');
    el.id = 'nav';
    el.innerHTML = `
      <div class="nav-top">
        <div class="nav-banner" aria-live="polite"><span class="nav-icon"></span><div class="nav-main"><div class="nav-dist"></div><div class="nav-text"></div></div></div>
        <div class="nav-then hidden"></div>
      </div>
      <button class="nav-mute nav-round" aria-label="Mute voice guidance"></button>
      <button class="nav-recenter hidden">${mi('navigation', 'fill')}Re-centre</button>
      <div class="nav-prompt card hidden"></div>
      <div class="nav-bottom card">
        <button class="nav-exit nav-round" title="Exit navigation" aria-label="Exit navigation">${mi('close')}</button>
        <div class="nav-stats"><div class="nav-rem"></div><div class="nav-sub"></div></div>
      </div>`;
    document.body.appendChild(el);
    $('.nav-exit', el).onclick = stop;
    $('.nav-recenter', el).onclick = recenter;
    $('.nav-mute', el).onclick = () => {
      muted = !muted; localStorage.setItem('map.nav.mute', muted ? '1' : '0');
      if (muted) window.speechSynthesis?.cancel();
      syncMute(); toast(muted ? 'Voice guidance off' : 'Voice guidance on', 1500);
    };
    return el;
  }
  function syncMute() {
    const b = $('.nav-mute', nav.ui);
    b.innerHTML = muted ? mi('volume_off') : mi('volume_up');
    b.title = muted ? 'Unmute voice guidance' : 'Mute voice guidance';
    b.classList.toggle('off', muted);
  }
  /** Set innerHTML only when it changed, so icons don't flicker on every GPS fix. */
  const put = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

  function render() {
    const ui = nav.ui, { steps, next, along, L } = nav;
    const banner = $('.nav-banner', ui), then = $('.nav-then', ui);
    banner.classList.toggle('alt', !!nav.rerouting);
    if (nav.arrived) {
      put($('.nav-icon', ui), mi('location_on', 'fill'));
      put($('.nav-dist', ui), 'You have arrived');
      put($('.nav-text', ui), esc(state.dir.to?.label || 'at your destination'));
    } else if (nav.rerouting) {
      put($('.nav-icon', ui), mi('alt_route'));
      put($('.nav-dist', ui), 'Rerouting…');
      put($('.nav-text', ui), '');
    } else {
      const s = steps[next];
      put($('.nav-icon', ui), stepIcon(s));
      put($('.nav-dist', ui), nav.fixed ? navDist(nav.stepAlong[next] - along) : '');
      put($('.nav-text', ui), esc(stepText(s)));
    }
    const s2 = steps[next + 1];
    then.classList.toggle('hidden', !s2 || !!nav.arrived || !!nav.rerouting);
    if (s2) put(then, `Then ${stepIcon(s2)}<span>${esc(stepText(s2))}</span>`);

    // Remaining time: the unfinished share of the current step plus every step after it.
    const cur = stepAt(along), stepLen = (nav.stepAlong[cur + 1] ?? L.total) - nav.stepAlong[cur];
    const frac = stepLen ? clamp(((nav.stepAlong[cur + 1] ?? L.total) - along) / stepLen, 0, 1) : 0;
    const remS = steps[cur].duration * frac + (nav.sufDur[cur + 1] || 0), remM = Math.max(0, L.total - along);
    put($('.nav-rem', ui), nav.arrived ? 'Arrived' : fmtDur(remS));
    put($('.nav-sub', ui), nav.arrived ? '' : `${fmtDist(remM)} · ${clock(remS)}${nav.sim ? ' · Simulated' : ''}`);
  }

  /** In-UI card, e.g. to offer a simulated drive when there's no GPS. */
  function showPrompt(html, actions) {
    const p = $('.nav-prompt', nav.ui);
    p.innerHTML = `${html}<div class="nav-prompt-actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
    p.classList.remove('hidden');
    p.querySelectorAll('button').forEach((b) => b.onclick = () => { p.classList.add('hidden'); actions[+b.dataset.i].run(); });
  }

  /* ---------------- Camera + marker ---------------- */
  function zoomFor(speed) {
    if (nav.mode === 'foot') return 18;
    if (nav.mode === 'bike') return 17.5;
    return 17.5 - clamp((speed - 8) / 22, 0, 1) * 2; // 17.5 in town, 15.5 at motorway speed
  }
  const padding = () => ({ top: innerHeight * 0.45, bottom: 90, left: 0, right: 0 }); // puts you in the lower third

  /** Smoothly move the arrow (and camera, while following) from where it is to the latest fix. */
  function animateTo(pos, brg, zoom, dur) {
    const s = nav.shown || { pos, brg, zoom };
    nav.anim = { from: { ...s }, to: { pos, brg, zoom }, t0: performance.now(), dur: reduceMotion() ? 0 : dur };
    cancelAnimationFrame(nav.raf);
    const step = (now) => {
      if (!nav) return;
      const { from, to, t0, dur: d } = nav.anim, t = d ? Math.min(1, (now - t0) / d) : 1;
      const db = ((to.brg - from.brg + 540) % 360) - 180; // shortest way round
      nav.shown = {
        pos: [from.pos[0] + (to.pos[0] - from.pos[0]) * t, from.pos[1] + (to.pos[1] - from.pos[1]) * t],
        brg: (from.brg + db * t + 360) % 360, zoom: from.zoom + (to.zoom - from.zoom) * t,
      };
      nav.marker.setLngLat(nav.shown.pos).setRotation(nav.shown.brg);
      if (nav.follow && !nav.hold && !map.isEasing()) map.jumpTo({ center: nav.shown.pos, bearing: nav.shown.brg, zoom: nav.shown.zoom, pitch: PITCH, padding: padding() });
      if (t < 1) nav.raf = requestAnimationFrame(step);
    };
    nav.raf = requestAnimationFrame(step);
  }
  function recenter() {
    const s = nav.shown; if (!s) return;
    $('.nav-recenter', nav.ui).classList.add('hidden');
    nav.follow = true; // per-frame camera updates resume once this ease finishes
    map.easeTo({ center: s.pos, bearing: s.brg, zoom: s.zoom, pitch: PITCH, padding: padding(), duration: reduceMotion() ? 0 : 800 });
  }
  function onUserMove(e) {
    if (!nav || !e?.originalEvent || !nav.follow) return;
    nav.follow = false;
    $('.nav-recenter', nav.ui).classList.remove('hidden');
  }
  // Panning, rotating, tilting or zooming by hand pauses following (programmatic moves have no originalEvent).
  ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach((ev) => map.on(ev, onUserMove));
  // jumpTo() cancels in-progress gestures, so hold the camera still while a finger/mouse is down.
  const box = map.getCanvasContainer();
  box.addEventListener('pointerdown', () => { if (nav) nav.hold = true; });
  addEventListener('pointerup', () => { if (nav) nav.hold = false; });
  addEventListener('pointercancel', () => { if (nav) nav.hold = false; });
  box.addEventListener('wheel', (e) => onUserMove({ originalEvent: e }), { passive: true });

  function arrowMarker() {
    const el = document.createElement('div');
    el.className = 'nav-arrow';
    el.innerHTML = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#fff" fill-opacity=".9"/><path d="M24 8 37 38 24 31 11 38Z" fill="#1a73e8" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    return new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  }

  /* ---------------- Position updates ---------------- */
  function onFix(pos) {
    if (!nav || nav.arrived) return;
    const c = pos.coords, raw = [c.longitude, c.latitude], t = pos.timestamp || Date.now();
    const prev = nav.lastFix, dt = prev ? (t - prev.t) / 1000 : 1;
    const measured = c.speed != null && c.speed >= 0 ? c.speed : prev && dt > 0 ? haversine(prev.raw, raw) / dt : 0;
    nav.speed = prev ? nav.speed * 0.6 + measured * 0.4 : measured;
    nav.lastFix = { raw, t };
    nav.fixed = true;
    $('.nav-prompt', nav.ui).classList.add('hidden');

    // Snap to the route near where we were; fall back to the whole route if we jumped.
    const { L } = nav, tol = Math.max(OFF_ROUTE_M, Math.min(c.accuracy || 0, 100));
    let snap = NavGeo.snap(L, raw, nav.along - 30, nav.along + Math.max(300, nav.speed * 30));
    if (snap.dist > tol) { const g = NavGeo.snap(L, raw); if (g.dist <= tol) snap = g; }

    let shownPos, brg;
    if (snap.dist <= tol) {
      nav.offSince = null;
      nav.along = snap.along;
      shownPos = snap.point;
      brg = NavGeo.bearing(NavGeo.pointAt(L, Math.max(0, nav.along - 5)), NavGeo.pointAt(L, Math.min(L.total, nav.along + 15)));
    } else {
      nav.offSince ??= t;
      if (t - nav.offSince > OFF_ROUTE_MS && !nav.rerouting) reroute(raw);
      shownPos = raw;
      const heading = c.heading != null && !Number.isNaN(c.heading) && nav.speed > 1 ? c.heading : null;
      brg = heading ?? (prev && haversine(prev.raw, raw) > 3 ? NavGeo.bearing(prev.raw, raw) : nav.shown?.brg ?? 0);
    }
    animateTo(shownPos, brg, zoomFor(nav.speed), clamp(dt * 1000, 300, 1500));

    // Arrival: at the end of the line, or simply close to the destination.
    const arriveM = nav.mode === 'car' ? 30 : 15;
    if (L.total - nav.along < arriveM || haversine(raw, L.coords[L.coords.length - 1]) < arriveM) return arrive();

    // Advance to the next maneuver ahead of us.
    let next = nav.next;
    while (next < nav.steps.length - 1 && nav.stepAlong[next] - nav.along < 3) next++;
    if (next !== nav.next) enterStep(next);
    voice();
    drawProgress();
    render();
  }

  function enterStep(next) {
    nav.next = next;
    const toNext = nav.stepAlong[next] - nav.along, T = VOICE[nav.mode];
    // Prompts we're already past (e.g. a short step) are skipped; "then …" chaining covers them.
    nav.spoken = nav.chained === next ? 2 : T.slice(0, 2).filter((d) => toNext <= d).length;
    if (toNext > T[0] * 3) { const s = nav.steps[next - 1]; say(`Continue${s.name ? ` on ${s.name}` : ''} for ${spokenDist(toNext)}`); }
  }

  function voice() {
    const toNext = nav.stepAlong[nav.next] - nav.along, T = VOICE[nav.mode];
    const thresholds = [T[0], T[1], Math.max(T[2], nav.speed * 3)]; // "now" a few seconds ahead at speed
    let stage = -1;
    while (nav.spoken < 3 && toNext <= thresholds[nav.spoken]) stage = nav.spoken++;
    if (stage < 0) return;
    const s = nav.steps[nav.next], text = stepText(s);
    if (stage < 2) return say(`In ${spokenDist(toNext)}, ${lcFirst(text)}`);
    if (s.maneuver.type === 'arrive') return; // arrive() announces it
    const s2 = nav.steps[nav.next + 1];
    const chain = s2 && s2.maneuver.type !== 'arrive' && nav.stepAlong[nav.next + 1] - nav.stepAlong[nav.next] < T[1];
    nav.chained = chain ? nav.next + 1 : null;
    say(chain ? `${text}, then ${lcFirst(stepText(s2))}` : text);
  }

  async function reroute(from) {
    nav.rerouting = true; render();
    const session = nav, to = nav.L.coords[nav.L.coords.length - 1];
    const url = `${CONFIG.osrm[nav.mode]}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
    try {
      const d = await getJSON(url);
      if (nav !== session) return;
      if (d.code !== 'Ok' || !d.routes?.length) throw new Error(d.code);
      setRoute(d.routes[0]);
      say(stepText(nav.steps[0]));
    } catch {
      if (nav !== session) return;
      toast("Couldn't find a new route. Trying again…");
    } finally {
      if (nav === session) { nav.rerouting = false; nav.offSince = null; render(); }
    }
  }

  function arrive() {
    nav.arrived = true;
    nav.along = nav.L.total;
    drawProgress(); render();
    say('You have arrived at your destination');
    stopTracking();
    nav.exitT = setTimeout(stop, 8000);
  }

  /* ---------------- Position sources ---------------- */
  function startGPS() {
    if (!navigator.geolocation) return offerSimulation("This browser can't share your location.");
    nav.watch = navigator.geolocation.watchPosition(onFix, (err) => {
      if (!nav) return;
      if (err.code === err.PERMISSION_DENIED) { stopTracking(); offerSimulation('Location access is turned off for this site.'); }
      else if (!nav.fixed) offerSimulation('Waiting for a GPS signal…');
      else toast('GPS signal lost. Waiting…');
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  function offerSimulation(why) {
    showPrompt(`<div class="nav-prompt-title">${mi('location_off')}Can't get your location</div><p>${esc(why)} Try a simulated drive along this route instead?</p>`,
      [{ label: 'Exit', run: stop }, { label: 'Simulate', primary: true, run: () => { stopTracking(); startSim(1); } }]);
  }
  /** Drive along the route at each step's OSRM speed (times `factor`), one fix per second. */
  function startSim(factor) {
    let along = 0;
    const tick = () => {
      if (!nav?.L) return;
      const s = nav.steps[stepAt(along)];
      const v = s.duration ? clamp(s.distance / s.duration, 1, 35) : 10;
      along = Math.min(nav.L.total, along + v * factor);
      const [longitude, latitude] = NavGeo.pointAt(nav.L, along);
      onFix({ coords: { longitude, latitude, accuracy: 5, speed: v * factor, heading: null }, timestamp: Date.now() });
    };
    nav.sim = setInterval(tick, 1000);
    tick();
  }
  function stopTracking() {
    if (nav.watch != null) navigator.geolocation.clearWatch(nav.watch);
    clearInterval(nav.sim);
    nav.watch = null;
  }

  /* ---------------- Wake lock ---------------- */
  async function keepAwake() {
    try { if (nav && 'wakeLock' in navigator) nav.lock = await navigator.wakeLock.request('screen'); } catch { /* not allowed, e.g. low battery */ }
  }
  // The browser drops the lock when the tab is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => { if (nav && document.visibilityState === 'visible') keepAwake(); });
  // Esc exits navigation (capture phase so the directions panel doesn't also close).
  document.addEventListener('keydown', (e) => { if (nav && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); } }, true);

  /* ---------------- Public API ---------------- */
  function start(route, mode = 'car', { simulate = false } = {}) {
    if (!route?.geometry?.coordinates?.length || !route.legs?.length) return toast('No route to navigate');
    if (nav) stop();
    nav = { mode: VOICE[mode] ? mode : 'car', follow: false, speed: 0, watch: null, sim: null };
    setRoute(route);
    nav.ui = buildUI();
    syncMute();
    nav.marker = arrowMarker().setLngLat(nav.L.coords[0]).addTo(map);
    document.body.classList.add('navigating');
    addLayers();
    const L = nav.L, brg = NavGeo.bearing(L.coords[0], NavGeo.pointAt(L, Math.min(L.total, 20)));
    nav.shown = { pos: L.coords[0], brg, zoom: zoomFor(0) };
    nav.marker.setRotation(brg);
    recenter();
    render();
    say(stepText(nav.steps[0])); // inside the click handler, which unlocks speech on iOS
    keepAwake();
    if (simulate) startSim(typeof simulate === 'number' ? simulate : 1); else startGPS();
  }

  function stop() {
    if (!nav) return;
    const n = nav;
    stopTracking();
    nav = null;
    clearTimeout(n.exitT); cancelAnimationFrame(n.raf);
    n.lock?.release().catch(() => {});
    window.speechSynthesis?.cancel();
    n.marker.remove(); n.ui.remove();
    removeLayers();
    document.body.classList.remove('navigating');
    // Back to the flat overview of the route.
    map.jumpTo({ pitch: 0, bearing: 0, padding: ZERO_PAD });
    const b = new maplibregl.LngLatBounds();
    n.L.coords.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: fitPadding(), duration: reduceMotion() ? 0 : 800 });
  }

  return { start, stop };
})();
