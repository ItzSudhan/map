/* Map: rich place details.
 * Photos (Wikipedia + Wikimedia Commons geotagged photos), Wikipedia summary, weather + air quality,
 * "Open now" from OSM opening_hours, plus code, local time, and nearby attractions.
 * All sources are free and need no API key. Uses globals from app.js (state, esc, getJSON, haversine, fmtDist, showPlace, toast, copy).
 */
const PlaceExtras = (() => {
  const cache = new Map(); // key -> { wiki, photos, weather, nearby } (each a Promise)
  const keyOf = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}|${p.name}`;
  const WIKI_LANG = 'en';
  const wikiApi = (lang = WIKI_LANG) => `https://${lang}.wikipedia.org`;
  const BIG = ['city', 'town', 'state', 'country', 'county', 'district', 'administrative', 'island'];
  const MID = ['suburb', 'neighbourhood', 'quarter', 'village', 'borough', 'park', 'lake', 'aerodrome', 'university'];

  /* ---------------- Wikipedia ---------------- */
  const normTitle = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function similar(a, b) {
    const A = normTitle(a), B = normTitle(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.includes(B) || B.includes(A)) return 0.85;
    const ta = new Set(A.split(' ')), tb = B.split(' ');
    return tb.filter((t) => ta.has(t)).length / Math.max(ta.size, tb.length);
  }
  async function findArticle(p) {
    const t = p.tags || {};
    if (t.wikipedia && t.wikipedia.includes(':')) {
      const [lang, ...rest] = t.wikipedia.split(':');
      return { lang, title: rest.join(':') };
    }
    if (t.wikidata) {
      try {
        const d = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${t.wikidata}.json`);
        const e = Object.values(d.entities)[0];
        const title = e.sitelinks?.enwiki?.title;
        const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (title) return { lang: 'en', title, commonsImage: img };
        if (img) return { commonsImage: img };
      } catch {}
    }
    if (!p.name || p.name === 'Dropped pin') return null;
    const radius = BIG.includes(p.value) ? 10000 : MID.includes(p.value) ? 3000 : 800;
    const d = await getJSON(`${wikiApi()}/w/api.php?action=query&list=geosearch&gscoord=${p.lat}|${p.lon}&gsradius=${radius}&gslimit=20&format=json&origin=*`);
    let best = null, bestScore = 0.55;
    for (const g of d.query?.geosearch || []) {
      const s = similar(g.title, p.name) - g.dist / (radius * 4);
      if (s > bestScore) { best = g; bestScore = s; }
    }
    return best ? { lang: 'en', title: best.title } : null;
  }
  async function loadWiki(p) {
    const art = await findArticle(p).catch(() => null);
    if (!art?.title) return art?.commonsImage ? { commonsImage: art.commonsImage } : null;
    const s = await getJSON(`${wikiApi(art.lang)}/api/rest_v1/page/summary/${encodeURIComponent(art.title.replace(/ /g, '_'))}`).catch(() => null);
    if (!s || s.type === 'disambiguation') return null;
    return {
      title: s.title, description: s.description, extract: s.extract, url: s.content_urls?.desktop?.page,
      image: s.originalimage?.source, thumb: s.thumbnail?.source, commonsImage: art.commonsImage, lang: art.lang,
    };
  }

  /* ---------------- Photos ---------------- */
  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.trim(); };
  const commonsThumb = (file, w = 1200) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, ''))}?width=${w}`;
  async function loadPhotos(p, wiki) {
    const photos = [];
    const seen = new Set();
    const add = (ph) => { const k = ph.title || ph.full; if (k && !seen.has(k)) { seen.add(k); photos.push(ph); } };
    if (wiki?.image) {
      const file = decodeURIComponent(wiki.image.split('/').pop()).replace(/^\d+px-/, '');
      add({ full: wiki.image, thumb: wiki.thumb || wiki.image, title: `File:${file}`, credit: 'Wikipedia', page: wiki.url });
    }
    if (wiki?.commonsImage) add({ full: commonsThumb(wiki.commonsImage), thumb: commonsThumb(wiki.commonsImage, 500), title: `File:${wiki.commonsImage}`, credit: 'Wikimedia Commons', page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(wiki.commonsImage)}` });
    const t = p.tags || {};
    if (/^https?:\/\/.+\.(jpe?g|png|webp)$/i.test(t.image || '')) add({ full: t.image, thumb: t.image, title: t.image, credit: 'OpenStreetMap contributor', page: t.image });
    if ((t.wikimedia_commons || '').startsWith('File:')) add({ full: commonsThumb(t.wikimedia_commons), thumb: commonsThumb(t.wikimedia_commons, 500), title: t.wikimedia_commons, credit: 'Wikimedia Commons', page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(t.wikimedia_commons)}` });

    // Geotagged photos taken near the place.
    const radius = BIG.includes(p.value) ? 2500 : MID.includes(p.value) ? 600 : p.name === 'Dropped pin' ? 300 : 200;
    try {
      const d = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${p.lat}|${p.lon}&ggsradius=${radius}&ggsnamespace=6&ggslimit=30&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1200&format=json&origin=*`);
      const pages = Object.values(d.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const pg of pages) {
        const ii = pg.imageinfo?.[0];
        if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime) || ii.width < 500) continue;
        if (/\b(map|locator|logo|plan|diagram|flag|coat of arms|signature)\b/i.test(pg.title)) continue;
        const m = ii.extmetadata || {};
        // 360° panoramas: equirectangular 2:1 frames that Commons also labels as panoramas/360°
        const pano = Math.abs(ii.width / ii.height - 2) < 0.01 && ii.width >= 3000
          && /360|spheric|equirect|photo ?sphere|panoram/i.test(`${pg.title} ${m.Categories?.value || ''}`);
        add({
          pano, panoUrl: pano ? (ii.thumburl || ii.url).replace(/\/\d+px-/, `/${Math.min(ii.width, 6000)}px-`) : null,
          full: ii.thumburl || ii.url, thumb: (ii.thumburl || ii.url).replace(/\/\d+px-/, '/500px-'),
          title: pg.title, page: ii.descriptionurl,
          credit: [stripHtml(m.Artist?.value), m.LicenseShortName?.value].filter(Boolean).join(' · ') || 'Wikimedia Commons',
          caption: stripHtml(m.ImageDescription?.value).slice(0, 140),
        });
        if (photos.length >= 18) break;
      }
    } catch {}
    return photos;
  }

  /* ---------------- Weather + air quality ---------------- */
  // WMO weather code -> [Material Symbol, label]
  const WMO = {
    0: ['sunny', 'Clear'], 1: ['sunny', 'Mostly clear'], 2: ['partly_cloudy_day', 'Partly cloudy'], 3: ['cloud', 'Overcast'], 45: ['foggy', 'Fog'], 48: ['foggy', 'Fog'],
    51: ['rainy_light', 'Light drizzle'], 53: ['rainy_light', 'Drizzle'], 55: ['rainy', 'Heavy drizzle'], 61: ['rainy_light', 'Light rain'], 63: ['rainy', 'Rain'], 65: ['rainy_heavy', 'Heavy rain'],
    66: ['rainy_snow', 'Freezing rain'], 67: ['rainy_snow', 'Freezing rain'], 71: ['weather_snowy', 'Light snow'], 73: ['weather_snowy', 'Snow'], 75: ['ac_unit', 'Heavy snow'], 77: ['weather_snowy', 'Snow grains'],
    80: ['rainy', 'Showers'], 81: ['rainy', 'Showers'], 82: ['rainy_heavy', 'Violent showers'], 85: ['weather_snowy', 'Snow showers'], 86: ['weather_snowy', 'Snow showers'],
    95: ['thunderstorm', 'Thunderstorm'], 96: ['thunderstorm', 'Thunderstorm, hail'], 99: ['thunderstorm', 'Thunderstorm, hail'],
  };
  const AQI = [[50, 'Good', '#1e8e3e'], [100, 'Moderate', '#f9ab00'], [150, 'Unhealthy for sensitive groups', '#e8710a'], [200, 'Unhealthy', '#d93025'], [300, 'Very unhealthy', '#9334e6'], [1e9, 'Hazardous', '#7b1f2e']];
  async function loadWeather(p) {
    const [w, aq] = await Promise.all([
      getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`),
      getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi,pm2_5`).catch(() => null),
    ]);
    return { w, aq };
  }

  /* ---------------- Nearby attractions ---------------- */
  async function loadNearby(p, wikiTitle) {
    const d = await getJSON(`${wikiApi()}/w/api.php?action=query&generator=geosearch&ggscoord=${p.lat}|${p.lon}&ggsradius=6000&ggslimit=30&prop=pageimages|description|coordinates&piprop=thumbnail&pithumbsize=320&format=json&origin=*`);
    return Object.values(d.query?.pages || {})
      .filter((x) => x.thumbnail && x.coordinates && x.title !== wikiTitle && normTitle(x.title) !== normTitle(p.name))
      .filter((x) => !/^(list of|districts? of|wards? of|.*constituency)/i.test(x.title))
      .sort((a, b) => a.index - b.index).slice(0, 12)
      .map((x) => ({ title: x.title, description: x.description, thumb: x.thumbnail.source, lat: x.coordinates[0].lat, lon: x.coordinates[0].lon }));
  }

  /* ---------------- Opening hours ("Open now") ---------------- */
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  /** Parse common OSM opening_hours like "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off". Returns per-day intervals or null. */
  function parseHours(str) {
    if (!str) return null;
    const s = str.trim();
    if (s === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
    const week = Array.from({ length: 7 }, () => null);
    for (let rule of s.split(';').map((r) => r.trim()).filter(Boolean)) {
      if (/^PH\b|^SH\b|week|\[|easter|"|\|\|/i.test(rule)) continue; // holidays / complex rules: skip
      let days = [0, 1, 2, 3, 4, 5, 6];
      const dm = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)(?:\s|$)/);
      if (dm) {
        days = [];
        for (const part of dm[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          const [a, b] = part.split('-').map((x) => DAYS.indexOf(x.trim()));
          if (a < 0) return null;
          if (b == null || b < 0) days.push(a);
          else for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
        }
        rule = rule.slice(dm[0].length).trim();
      }
      if (/^(off|closed)$/i.test(rule)) { days.forEach((d) => (week[d] = [])); continue; }
      const times = [...rule.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?/g)];
      if (!times.length) { if (rule) return null; continue; }
      const iv = times.map(([, a, b]) => { const s0 = toMin(a); let e = toMin(b); if (e <= s0) e += 1440; return [s0, e]; });
      days.forEach((d) => (week[d] = iv));
    }
    return week.map((x) => x || []);
  }
  const fmtClock = (min) => { const d = new Date(2000, 0, 1, Math.floor(min / 60) % 24, min % 60); return d.toLocaleTimeString([], { hour: 'numeric', minute: min % 60 ? '2-digit' : undefined }); };
  function openStatus(str, now = new Date()) {
    const week = parseHours(str);
    if (!week) return null;
    const day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    // Intervals from yesterday that run past midnight
    for (const [s, e] of week[(day + 6) % 7]) if (e > 1440 && mins < e - 1440) return { open: true, text: `Open · Closes ${fmtClock(e - 1440)}` };
    for (const [s, e] of week[day]) {
      if (e - s >= 1440) return { open: true, text: 'Open 24 hours' };
      if (mins >= s && mins < e) return { open: true, text: `Open · Closes ${fmtClock(e % 1440)}`, soon: e - mins <= 60 };
    }
    for (let k = 0; k < 7; k++) {
      const d = (day + k) % 7;
      const next = week[d].map(([s]) => s).filter((s) => k > 0 || s > mins).sort((a, b) => a - b)[0];
      if (next != null) return { open: false, text: `Closed · Opens ${k === 0 ? '' : k === 1 ? 'tomorrow ' : DAYS[d] + ' '}${fmtClock(next)}` };
    }
    return { open: false, text: 'Closed' };
  }

  /* ---------------- Plus code (Open Location Code) ---------------- */
  function plusCode(lat, lon) {
    const A = '23456789CFGHJMPQRVWX', res = [20, 1, 0.05, 0.0025, 0.000125];
    let la = Math.min(Math.max(lat, -90), 90 - 1e-9) + 90, lo = (((lon + 180) % 360) + 360) % 360, code = '';
    for (let i = 0; i < 5; i++) {
      const a = Math.floor(la / res[i] + 1e-9), b = Math.floor(lo / res[i] + 1e-9);
      la -= a * res[i]; lo -= b * res[i];
      code += A[a] + A[b];
      if (i === 3) code += '+';
    }
    return code;
  }

  /* ---------------- Rendering ---------------- */
  const $id = (id) => document.getElementById(id);
  let gen = 0; // bumps on every card render; stale async callbacks are ignored
  let cur = 0;
  const live = (p) => state.place === p && cur === gen;

  function heroHTML(photos) {
    const n = photos.length;
    const badge = (ph) => (ph.pano ? `<span class="pano-badge">${mi('360')}</span>` : '');
    const img = (ph, i, cls) => `<button class="ph ${cls}" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${esc(ph.thumb)}" alt="" loading="lazy" onload="this.classList.add('loaded')">${badge(ph)}</button>`;
    return `<div class="hero-grid n${Math.min(n, 3)}">
      ${img(photos[0], 0, 'main')}${n > 1 ? img(photos[1], 1, 'side') : ''}${n > 2 ? img(photos[2], 2, 'side') : ''}
      <button class="ph-count" data-i="0">${mi('photo_library')} ${n} photo${n === 1 ? '' : 's'}</button></div>`;
  }
  function renderPhotos(p, photos) {
    const hero = $id('pe-hero'); if (!hero || !live(p)) return;
    if (!photos.length) return;
    hero.classList.add('has-photos');
    hero.innerHTML = heroHTML(photos);
    hero.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) Lightbox.open(photos, +b.dataset.i); };
    const grid = $id('pe-photos-grid');
    if (grid && photos.length > 3) {
      grid.innerHTML = `<div class="pe-section"><div class="pe-title">Photos</div><div class="strip">${photos.map((ph, i) =>
        `<button class="strip-ph" data-i="${i}"><img src="${esc(ph.thumb)}" alt="" loading="lazy" onload="this.classList.add('loaded')">${ph.pano ? `<span class="pano-badge">${mi('360')}</span>` : ''}</button>`).join('')}</div></div>`;
      grid.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) Lightbox.open(photos, +b.dataset.i); };
    }
  }
  function renderWiki(p, wiki) {
    const el = $id('pe-about'); if (!el || !live(p) || !wiki?.extract) return;
    el.innerHTML = `<div class="pe-about">
      ${wiki.description ? `<div class="pe-desc">${esc(wiki.description[0].toUpperCase() + wiki.description.slice(1))}</div>` : ''}
      <p class="pe-extract clamp">${esc(wiki.extract)}</p>
      <div class="pe-about-links"><button class="pe-more">More</button>${wiki.url ? `<a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ''}</div></div>`;
    const ex = el.querySelector('.pe-extract'), more = el.querySelector('.pe-more');
    requestAnimationFrame(() => { if (ex.scrollHeight <= ex.clientHeight + 2) more.remove(); });
    more?.addEventListener('click', () => { ex.classList.toggle('clamp'); more.textContent = ex.classList.contains('clamp') ? 'More' : 'Less'; });
  }
  function renderWeather(p, data) {
    const el = $id('pe-weather'); if (!el || !live(p) || !data?.w?.current) return;
    const { w, aq } = data, c = w.current, d = w.daily || {};
    let [icon, label] = WMO[c.weather_code] || ['thermostat', ''];
    if (c.is_day === 0) icon = { sunny: 'clear_night', partly_cloudy_day: 'partly_cloudy_night' }[icon] || icon;
    const aqi = aq?.current?.us_aqi;
    const band = aqi != null ? AQI.find(([max]) => aqi <= max) : null;
    const time = (iso) => iso ? new Date(iso + ':00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    el.innerHTML = `<div class="pe-section"><div class="pe-title">Weather now</div>
      <div class="wx">
        <div class="wx-main"><span class="wx-icon mi fill wx-${icon}">${icon}</span>
          <span class="wx-temp">${Math.round(c.temperature_2m)}°</span>
          <span class="wx-text">${esc(label)}<small>Feels ${Math.round(c.apparent_temperature)}° · H ${Math.round(d.temperature_2m_max?.[0])}° L ${Math.round(d.temperature_2m_min?.[0])}°</small></span></div>
        <div class="wx-grid">
          <div><b>${c.relative_humidity_2m}%</b><span>Humidity</span></div>
          <div><b>${Math.round(c.wind_speed_10m)} km/h</b><span>Wind</span></div>
          ${d.precipitation_probability_max?.[0] != null ? `<div><b>${d.precipitation_probability_max[0]}%</b><span>Rain chance</span></div>` : ''}
          ${d.sunrise?.[0] ? `<div><b>${time(d.sunrise[0])}</b><span>Sunrise</span></div><div><b>${time(d.sunset[0])}</b><span>Sunset</span></div>` : ''}
          ${band ? `<div><b class="aqi" style="background:${band[2]}">${aqi}</b><span>AQI · ${band[1]}</span></div>` : ''}
        </div></div>
      <div class="pe-credit">Weather by <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></div></div>`;
    // Local time + elevation rows, now that we know the place's time zone
    const rows = $id('pe-extra-rows');
    if (rows && w.utc_offset_seconds != null) {
      const placeOffset = w.utc_offset_seconds / 60, myOffset = -new Date().getTimezoneOffset();
      if (placeOffset !== myOffset) {
        const t = new Date(Date.now() + (placeOffset - myOffset) * 60000);
        rows.insertAdjacentHTML('afterbegin', `<div class="info-row"><span class="ir-icon">${mi('schedule')}</span><span>Local time ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${esc(w.timezone_abbreviation || w.timezone)})</span></div>`);
      }
      if (w.elevation != null) rows.insertAdjacentHTML('beforeend', `<div class="info-row"><span class="ir-icon">${mi('landscape')}</span><span>Elevation ${Math.round(w.elevation)} m</span></div>`);
    }
  }
  function renderNearby(p, list) {
    const el = $id('pe-nearby'); if (!el || !live(p) || !list?.length) return;
    el.innerHTML = `<div class="pe-section"><div class="pe-title">Explore nearby</div><div class="strip">${list.map((x, i) => `
      <button class="nb-card" data-i="${i}"><img src="${esc(x.thumb)}" alt="" loading="lazy" onload="this.classList.add('loaded')">
        <span class="nb-name">${esc(x.title)}</span><span class="nb-sub">${esc(fmtDist(haversine([p.lon, p.lat], [x.lon, x.lat])))}${x.description ? ' · ' + esc(x.description) : ''}</span></button>`).join('')}</div></div>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const x = list[+b.dataset.i];
      showPlace({ name: x.title, category: x.description || '', address: '', short: '', lat: x.lat, lon: x.lon, tags: { wikipedia: `en:${x.title}` }, value: 'attraction' }, { fly: true });
    };
  }
  function renderStatic(p) {
    // Open now / closed
    const st = openStatus(p.tags?.opening_hours);
    const s = $id('pe-status');
    if (s && st) s.innerHTML = `<span class="open-badge ${st.open ? (st.soon ? 'soon' : 'open') : 'closed'}">${esc(st.text)}</span>`;
    // Extra detail rows from OSM tags + plus code
    const rows = $id('pe-extra-rows'); if (!rows) return;
    const t = p.tags || {}, out = [];
    const nice = (v) => v.replace(/_/g, ' ').replace(/;/g, ', ');
    if (t.cuisine) out.push([mi('restaurant_menu'), `Cuisine: ${nice(t.cuisine)}`]);
    const diet = Object.keys(t).filter((k) => k.startsWith('diet:') && /yes|only/.test(t[k])).map((k) => k.slice(5));
    if (diet.length) out.push([mi('eco'), `Diet: ${nice(diet.join(', '))}`]);
    const pay = Object.keys(t).filter((k) => k.startsWith('payment:') && t[k] === 'yes').map((k) => k.slice(8));
    if (pay.length) out.push([mi('credit_card'), `Payment: ${nice(pay.join(', '))}`]);
    const feats = [['internet_access', 'Wi-Fi'], ['outdoor_seating', 'Outdoor seating'], ['takeaway', 'Takeaway'], ['delivery', 'Delivery'], ['air_conditioning', 'Air-conditioned'], ['parking', 'Parking']]
      .filter(([k]) => t[k] && t[k] !== 'no').map(([, l]) => l);
    if (feats.length) out.push([mi('check_circle'), feats.join(' · ')]);
    if (t.operator || t.brand) out.push([mi('business'), esc(t.brand || t.operator)]);
    if (t.email || t['contact:email']) out.push([mi('mail'), `<a href="mailto:${esc(t.email || t['contact:email'])}">${esc(t.email || t['contact:email'])}</a>`]);
    const pc = plusCode(p.lat, p.lon);
    out.push([mi('pin_drop'), `<span title="Plus code: a short address for anywhere">${pc}</span>`, 'plus']);
    rows.innerHTML = out.map(([i, h, k]) => `<div class="info-row" ${k ? `data-k="${k}"` : ''}><span class="ir-icon">${i}</span><span>${h}</span></div>`).join('');
    rows.querySelector('[data-k="plus"]')?.addEventListener('click', () => copy(pc, 'Plus code copied'));
  }

  /** Called by app.js every time a place card is rendered. */
  function render(p) {
    const my = ++gen;
    const guard = (fn) => (v) => { cur = my; fn(v); };
    renderStatic(p);
    const k = keyOf(p);
    let c = cache.get(k);
    if (!c || (p.tags && Object.keys(p.tags).length && !c.hadTags)) {
      const wiki = loadWiki(p).catch(() => null);
      c = {
        hadTags: !!(p.tags && Object.keys(p.tags).length),
        wiki,
        photos: wiki.then((w) => loadPhotos(p, w)).catch(() => []),
        weather: loadWeather(p).catch(() => null),
        nearby: wiki.then((w) => loadNearby(p, w?.title)).catch(() => []),
      };
      cache.set(k, c);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    c.wiki.then(guard((w) => renderWiki(p, w)));
    c.photos.then(guard((ph) => renderPhotos(p, ph)));
    c.weather.then(guard((w) => renderWeather(p, w)));
    c.nearby.then(guard((n) => renderNearby(p, n)));
  }

  return { render, openStatus, plusCode };
})();

/* ---------------- Full-screen photo viewer ---------------- */
const Lightbox = (() => {
  let el, photos = [], i = 0, touchX = null;
  function build() {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'hidden';
    el.innerHTML = `
      <button class="lb-close" aria-label="Close">${mi('close')}</button>
      <button class="lb-nav prev" aria-label="Previous">${mi('chevron_left')}</button>
      <figure><img alt=""><figcaption><span class="lb-cap"></span><a class="lb-credit" target="_blank" rel="noopener"></a><span class="lb-count"></span></figcaption></figure>
      <button class="lb-360 hidden">${mi('360')} View in 360°</button>
      <button class="lb-nav next" aria-label="Next">${mi('chevron_right')}</button>`;
    document.body.appendChild(el);
    el.querySelector('.lb-close').onclick = close;
    el.querySelector('.prev').onclick = () => go(-1);
    el.querySelector('.next').onclick = () => go(1);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touchX = null; });
    document.addEventListener('keydown', (e) => {
      if (el.classList.contains('hidden')) return;
      if (e.key === 'Escape') { close(); e.stopPropagation(); } else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    }, true);
  }
  function show() {
    const ph = photos[i], img = el.querySelector('img');
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');
    img.src = ph.full;
    el.querySelector('.lb-cap').textContent = ph.caption || ph.title?.replace(/^File:/, '').replace(/\.\w+$/, '').replace(/_/g, ' ') || '';
    const cr = el.querySelector('.lb-credit'); cr.textContent = ph.credit || ''; cr.href = ph.page || '#';
    el.querySelector('.lb-count').textContent = photos.length > 1 ? `${i + 1} / ${photos.length}` : '';
    const b360 = el.querySelector('.lb-360');
    b360.classList.toggle('hidden', !ph.pano);
    b360.onclick = () => Pano360.open(ph.panoUrl || ph.full, { title: el.querySelector('.lb-cap').textContent || '360° view', credit: ph.credit, page: ph.page });
    el.querySelectorAll('.lb-nav').forEach((b) => b.classList.toggle('hidden', photos.length < 2));
    // Preload neighbours
    [1, -1].forEach((d) => { const n = photos[(i + d + photos.length) % photos.length]; if (n) new Image().src = n.full; });
  }
  function go(d) { i = (i + d + photos.length) % photos.length; show(); }
  function open(list, start = 0) { if (!el) build(); photos = list; i = start; el.classList.remove('hidden'); show(); }
  function close() { el?.classList.add('hidden'); }
  return { open, close };
})();
