/* Map: search engine.
 * Combines several free geocoder queries (Photon, plus Nominatim for full searches),
 * then ranks the merged results Google-style: name match (typo tolerant), place
 * importance, place type, and distance to you / the map / the place you named ("X in Y").
 * Loaded after app.js; uses its globals (map, state, photonToPlace, haversine, CONFIG, getJSON, matchCategory).
 */
const Search = (() => {
  const NOMINATIM = 'https://nominatim.openstreetmap.org';

  /* Major cities, used to label results whose OSM address only has a sub-district
   * (e.g. "Sanganer Tehsil" -> "Jaipur") and to resolve "X in <city>" instantly. */
  const CITIES = [
    ['Delhi', 28.6139, 77.209, 'Delhi'], ['New Delhi', 28.6139, 77.209, 'Delhi'], ['Mumbai', 19.076, 72.8777, 'Maharashtra'],
    ['Navi Mumbai', 19.033, 73.0297, 'Maharashtra'], ['Thane', 19.2183, 72.9781, 'Maharashtra'], ['Pune', 18.5204, 73.8567, 'Maharashtra'],
    ['Nagpur', 21.1458, 79.0882, 'Maharashtra'], ['Nashik', 19.9975, 73.7898, 'Maharashtra'], ['Aurangabad', 19.8762, 75.3433, 'Maharashtra'],
    ['Bengaluru', 12.9716, 77.5946, 'Karnataka'], ['Bangalore', 12.9716, 77.5946, 'Karnataka'], ['Mysuru', 12.2958, 76.6394, 'Karnataka'],
    ['Mangaluru', 12.9141, 74.856, 'Karnataka'], ['Hubli', 15.3647, 75.124, 'Karnataka'], ['Chennai', 13.0827, 80.2707, 'Tamil Nadu'],
    ['Coimbatore', 11.0168, 76.9558, 'Tamil Nadu'], ['Madurai', 9.9252, 78.1198, 'Tamil Nadu'], ['Tiruchirappalli', 10.7905, 78.7047, 'Tamil Nadu'],
    ['Trichy', 10.7905, 78.7047, 'Tamil Nadu'], ['Salem', 11.6643, 78.146, 'Tamil Nadu'], ['Tirunelveli', 8.7139, 77.7567, 'Tamil Nadu'],
    ['Vellore', 12.9165, 79.1325, 'Tamil Nadu'], ['Hyderabad', 17.385, 78.4867, 'Telangana'], ['Warangal', 17.9689, 79.5941, 'Telangana'],
    ['Visakhapatnam', 17.6868, 83.2185, 'Andhra Pradesh'], ['Vijayawada', 16.5062, 80.648, 'Andhra Pradesh'], ['Guntur', 16.3067, 80.4365, 'Andhra Pradesh'],
    ['Tirupati', 13.6288, 79.4192, 'Andhra Pradesh'], ['Kolkata', 22.5726, 88.3639, 'West Bengal'], ['Howrah', 22.5958, 88.2636, 'West Bengal'],
    ['Siliguri', 26.7271, 88.3953, 'West Bengal'], ['Durgapur', 23.5204, 87.3119, 'West Bengal'], ['Ahmedabad', 23.0225, 72.5714, 'Gujarat'],
    ['Surat', 21.1702, 72.8311, 'Gujarat'], ['Vadodara', 22.3072, 73.1812, 'Gujarat'], ['Rajkot', 22.3039, 70.8022, 'Gujarat'],
    ['Gandhinagar', 23.2156, 72.6369, 'Gujarat'], ['Bhavnagar', 21.7645, 72.1519, 'Gujarat'], ['Jaipur', 26.9124, 75.7873, 'Rajasthan'],
    ['Jodhpur', 26.2389, 73.0243, 'Rajasthan'], ['Udaipur', 24.5854, 73.7125, 'Rajasthan'], ['Kota', 25.2138, 75.8648, 'Rajasthan'],
    ['Ajmer', 26.4499, 74.6399, 'Rajasthan'], ['Bikaner', 28.0229, 73.3119, 'Rajasthan'], ['Lucknow', 26.8467, 80.9462, 'Uttar Pradesh'],
    ['Kanpur', 26.4499, 80.3319, 'Uttar Pradesh'], ['Agra', 27.1767, 78.0081, 'Uttar Pradesh'], ['Varanasi', 25.3176, 82.9739, 'Uttar Pradesh'],
    ['Prayagraj', 25.4358, 81.8463, 'Uttar Pradesh'], ['Meerut', 28.9845, 77.7064, 'Uttar Pradesh'], ['Ghaziabad', 28.6692, 77.4538, 'Uttar Pradesh'],
    ['Noida', 28.5355, 77.391, 'Uttar Pradesh'], ['Bareilly', 28.367, 79.4304, 'Uttar Pradesh'], ['Aligarh', 27.8974, 78.088, 'Uttar Pradesh'],
    ['Gorakhpur', 26.7606, 83.3732, 'Uttar Pradesh'], ['Gurugram', 28.4595, 77.0266, 'Haryana'], ['Gurgaon', 28.4595, 77.0266, 'Haryana'],
    ['Faridabad', 28.4089, 77.3178, 'Haryana'], ['Chandigarh', 30.7333, 76.7794, 'Chandigarh'], ['Ludhiana', 30.901, 75.8573, 'Punjab'],
    ['Amritsar', 31.634, 74.8723, 'Punjab'], ['Jalandhar', 31.326, 75.5762, 'Punjab'], ['Patiala', 30.3398, 76.3869, 'Punjab'],
    ['Bhopal', 23.2599, 77.4126, 'Madhya Pradesh'], ['Indore', 22.7196, 75.8577, 'Madhya Pradesh'], ['Gwalior', 26.2183, 78.1828, 'Madhya Pradesh'],
    ['Jabalpur', 23.1815, 79.9864, 'Madhya Pradesh'], ['Ujjain', 23.1765, 75.7885, 'Madhya Pradesh'], ['Raipur', 21.2514, 81.6296, 'Chhattisgarh'],
    ['Bhilai', 21.1938, 81.3509, 'Chhattisgarh'], ['Patna', 25.5941, 85.1376, 'Bihar'], ['Gaya', 24.7914, 85.0002, 'Bihar'],
    ['Ranchi', 23.3441, 85.3096, 'Jharkhand'], ['Jamshedpur', 22.8046, 86.2029, 'Jharkhand'], ['Dhanbad', 23.7957, 86.4304, 'Jharkhand'],
    ['Bhubaneswar', 20.2961, 85.8245, 'Odisha'], ['Cuttack', 20.4625, 85.8828, 'Odisha'], ['Guwahati', 26.1445, 91.7362, 'Assam'],
    ['Kochi', 9.9312, 76.2673, 'Kerala'], ['Thiruvananthapuram', 8.5241, 76.9366, 'Kerala'], ['Kozhikode', 11.2588, 75.7804, 'Kerala'],
    ['Thrissur', 10.5276, 76.2144, 'Kerala'], ['Dehradun', 30.3165, 78.0322, 'Uttarakhand'], ['Haridwar', 29.9457, 78.1642, 'Uttarakhand'],
    ['Shimla', 31.1048, 77.1734, 'Himachal Pradesh'], ['Srinagar', 34.0837, 74.7973, 'Jammu and Kashmir'], ['Jammu', 32.7266, 74.857, 'Jammu and Kashmir'],
    ['Panaji', 15.4909, 73.8278, 'Goa'], ['Puducherry', 11.9416, 79.8083, 'Puducherry'], ['Imphal', 24.817, 93.9368, 'Manipur'],
    ['Shillong', 25.5788, 91.8933, 'Meghalaya'], ['Agartala', 23.8315, 91.2868, 'Tripura'], ['Gangtok', 27.3389, 88.6065, 'Sikkim'],
    ['Kathmandu', 27.7172, 85.324, 'Bagmati'], ['Dhaka', 23.8103, 90.4125, 'Dhaka'], ['Colombo', 6.9271, 79.8612, 'Western Province'],
    ['Karachi', 24.8607, 67.0011, 'Sindh'], ['Lahore', 31.5204, 74.3587, 'Punjab'], ['Dubai', 25.2048, 55.2708, 'Dubai'],
    ['London', 51.5072, -0.1276, 'England'], ['Paris', 48.8566, 2.3522, 'Île-de-France'], ['New York', 40.7128, -74.006, 'New York'],
    ['San Francisco', 37.7749, -122.4194, 'California'], ['Los Angeles', 34.0522, -118.2437, 'California'], ['Singapore', 1.3521, 103.8198, 'Singapore'],
    ['Tokyo', 35.6762, 139.6503, 'Tokyo'], ['Sydney', -33.8688, 151.2093, 'New South Wales'], ['Toronto', 43.6532, -79.3832, 'Ontario'],
  ].map(([name, lat, lon, state]) => ({ name, lat, lon, state }));

  /* ---------- text helpers ---------- */
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // Common Indian transliteration differences: sarovar/sarowar, aa/a, ee/i, oo/u, sh/s
  const translit = (w) => w.replace(/w/g, 'v').replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/sh/g, 's').replace(/ph/g, 'f');
  /* Old/alternate city names, so "mg road bangalore" matches addresses in "Bengaluru". */
  const ALIASES = { bangalore: 'bengaluru', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai', gurgaon: 'gurugram',
    mysore: 'mysuru', pondicherry: 'puducherry', poona: 'pune', baroda: 'vadodara', benares: 'varanasi', banaras: 'varanasi',
    allahabad: 'prayagraj', cochin: 'kochi', trivandrum: 'thiruvananthapuram', trichy: 'tiruchirappalli', calicut: 'kozhikode',
    mangalore: 'mangaluru', vizag: 'visakhapatnam', simla: 'shimla', ooty: 'udhagamandalam', delhi: 'delhi', ncr: 'delhi' };
  const alias = (w) => ALIASES[w] || w;
  /** Strip admin suffixes: "Jaipur Municipal Corporation" -> "Jaipur" */
  const cleanAdmin = (s) => (s || '').replace(/\s+(Municipal Corporation|Municipal Council|Nagar Nigam|Nagar Palika|Cantonment Board|Metropolitan Region|Urban|Mahanagar Palika)$/i, '').trim();
  const isSubDistrict = (s) => /\b(tehsil|taluka|taluk|mandal|block|subdistrict|sub-district|district)\b/i.test(s || '');

  /** How well one typed word matches a list of words: 1 exact, .9 prefix, .75 typo, 0 none. */
  function wordMatch(qt, words) {
    let best = 0;
    const tq = translit(qt);
    for (const w of words) {
      if (w === qt) return 1;
      if (w.startsWith(qt) && qt.length >= 2) best = Math.max(best, qt.length >= 3 ? 0.92 : 0.8);
      else if (translit(w) === tq || (translit(w).startsWith(tq) && tq.length >= 3)) best = Math.max(best, 0.88);
      else if (qt.length >= 4) {
        const max = qt.length >= 8 ? 2 : 1;
        const target = w.slice(0, Math.max(qt.length, Math.min(w.length, qt.length + 1)));
        if (lev(tq, translit(target), max) <= max) best = Math.max(best, 0.72);
      }
    }
    return best;
  }

  /* ---------- labels ---------- */
  function nearestCity(lat, lon, maxKm = 35) {
    let best = null, bestD = maxKm * 1000;
    for (const c of CITIES) {
      const d = haversine([lon, lat], [c.lon, c.lat]);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  /** Fill in region (city) + a clearer one-line address for a place. */
  function label(p, props = {}) {
    let city = cleanAdmin(props.city || props.town || props.village);
    if (city && isSubDistrict(city)) city = '';
    const near = city ? null : nearestCity(p.lat, p.lon);
    p.region = city || near?.name || props.county || props.state || '';
    p.state = props.state || near?.state || '';
    const local = [props.housenumber && props.street ? `${props.housenumber} ${props.street}` : props.street, props.locality, cleanAdmin(props.district)]
      .filter(Boolean).filter((x) => x !== p.name)[0];
    const parts = [local, p.region, p.state !== p.region ? p.state : null, props.countrycode && props.countrycode !== 'IN' ? props.country : null];
    p.short = [...new Set(parts.filter(Boolean))].filter((x) => x !== p.name).slice(0, 3).join(', ') || p.short;
    return p;
  }

  /* ---------- sources ---------- */
  const lang = () => (['en', 'de', 'fr', 'it'].includes(navigator.language.slice(0, 2)) ? navigator.language.slice(0, 2) : 'en');
  async function photon(q, { lat, lon, zoom = 12, scale = 0.5, limit = 20, tag } = {}, signal) {
    let url = `${CONFIG.photon}/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=${lang()}`;
    if (lat != null) url += `&lat=${lat}&lon=${lon}&zoom=${zoom}&location_bias_scale=${scale}`;
    if (tag) url += tag.map((t) => `&osm_tag=${t}`).join('');
    let data;
    try { data = await getJSON(url, { signal }); } catch (e) {
      if (signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, 700)); // free server is busy: retry once
      data = await getJSON(url, { signal });
    }
    return data.features.map((f) => label(photonToPlace(f), f.properties));
  }
  async function nominatim(q, bias, signal) {
    let url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=10&addressdetails=1&accept-language=${lang()}`;
    if (bias) {
      const d = 1.5; // degrees: prefer (not restrict to) the area around the bias point
      url += `&viewbox=${bias.lon - d},${bias.lat + d},${bias.lon + d},${bias.lat - d}`;
    }
    const rows = await getJSON(url, { signal });
    return rows.map((r) => {
      const a = r.address || {};
      const p = {
        name: r.name || r.display_name.split(',')[0], type: r.category, value: r.type,
        category: catLabel(r.type === 'yes' ? r.category : r.type), address: r.display_name,
        lat: +r.lat, lon: +r.lon, osm: r.osm_type ? { type: r.osm_type[0].toUpperCase(), id: r.osm_id } : null, tags: {},
        extent: r.boundingbox ? [+r.boundingbox[2], +r.boundingbox[1], +r.boundingbox[3], +r.boundingbox[0]] : null,
        importance: r.importance || 0,
      };
      return label(p, { city: a.city || a.town || a.village, county: a.county || a.state_district, state: a.state, street: a.road,
        housenumber: a.house_number, locality: a.suburb || a.neighbourhood, district: a.city_district, country: a.country, countrycode: (a.country_code || '').toUpperCase() });
    });
  }

  /* ---------- query understanding ---------- */
  /** "mansarovar in jaipur" / "cafes near india gate" / "mansarovar, jaipur" -> {what, where} */
  function parse(q) {
    const m = q.match(/^(.+?)\s+(?:in|near|at|around|nearby|close to)\s+(.+)$/i);
    if (m && m[2].trim().length >= 3) return { what: m[1].trim(), where: m[2].trim() };
    const c = q.split(',');
    if (c.length >= 2 && c[0].trim() && c.at(-1).trim().length >= 3) return { what: c.slice(0, -1).join(',').trim(), where: c.at(-1).trim(), comma: true };
    return { what: q.trim(), where: null };
  }
  const whereCache = new Map();
  async function resolveWhere(where, signal) {
    const key = norm(where);
    if (whereCache.has(key)) return whereCache.get(key);
    const city = CITIES.find((c) => norm(c.name) === key);
    let loc = city ? { name: city.name, lat: city.lat, lon: city.lon, state: city.state } : null;
    if (!loc) {
      const res = await photon(where, { ...biasCenter(), limit: 5 }, signal).catch(() => []);
      const best = res.find((p) => ['city', 'town', 'village', 'suburb', 'state', 'county', 'district', 'neighbourhood', 'quarter'].includes(p.value)) || res[0];
      if (best) loc = { name: best.name, lat: best.lat, lon: best.lon, state: best.state, extent: best.extent };
    }
    whereCache.set(key, loc);
    return loc;
  }

  /* ---------- bias points: you, the map, your rough (IP) area ---------- */
  let ipLoc = JSON.parse(sessionStorage.getItem('map.iploc') || 'null');
  function biasCenter() {
    if (state.me) return { lat: state.me.lat, lon: state.me.lon, zoom: 12, scale: 0.5 };
    if (map.getZoom() >= 6) { const c = map.getCenter(); return { lat: c.lat, lon: c.lng, zoom: Math.round(map.getZoom()), scale: 0.5 }; }
    if (ipLoc) return { lat: ipLoc.lat, lon: ipLoc.lon, zoom: 9, scale: 0.3 };
    return {};
  }
  function biasPoints() {
    const pts = [];
    if (state.me) pts.push({ lat: state.me.lat, lon: state.me.lon, w: 1 });
    if (map.getZoom() >= 6) { const c = map.getCenter(); pts.push({ lat: c.lat, lon: c.lng, w: map.getZoom() >= 10 ? 0.95 : 0.7 }); }
    if (ipLoc) pts.push({ lat: ipLoc.lat, lon: ipLoc.lon, w: 0.35 });
    return pts;
  }
  async function loadIpLocation() {
    if (ipLoc) return ipLoc;
    try {
      const r = await getJSON('https://get.geojs.io/v1/ip/geo.json');
      if (r.latitude) { ipLoc = { lat: +r.latitude, lon: +r.longitude, city: r.city, country: r.country_code }; sessionStorage.setItem('map.iploc', JSON.stringify(ipLoc)); }
    } catch {}
    return ipLoc;
  }

  /* ---------- scoring ---------- */
  const TYPE_W = {
    city: 24, town: 20, state: 18, country: 18, county: 12, district: 12, suburb: 18, neighbourhood: 16, quarter: 16, borough: 16,
    village: 9, hamlet: 4, locality: 8, island: 10, aerodrome: 18, station: 15, attraction: 14, museum: 12, monument: 13, memorial: 12,
    castle: 12, fort: 12, palace: 13, temple: 10, university: 11, college: 8, hospital: 9, mall: 11, stadium: 11, park: 8, lake: 9,
    zoo: 11, theme_park: 12, viewpoint: 8, beach: 10, restaurant: 4, cafe: 4, hotel: 5, cinema: 6, place_of_worship: 7, administrative: 12,
  };
  const ROAD_WORDS = /\b(road|rd|marg|street|st|lane|path|highway|nh|avenue|ave|gali|chowk)\b/;
  function score(p, ctx) {
    const qWords = ctx.qWords;
    const nameWords = norm(p.name).split(' ');
    const initials = nameWords.filter((w) => w.length > 2 || /^\d/.test(w)).map((w) => w[0]).join('');
    const addrWords = norm([p.short, p.region, p.state, p.address].join(' ')).split(' ').map(alias);
    let text = 0, missing = 0, inNameCount = 0;
    for (const qt0 of qWords) {
      const qt = alias(qt0);
      let inName = wordMatch(qt, nameWords);
      // Abbreviations: "iit" -> "Indian Institute of Technology", "aiims", "wtp"
      if (!inName && qt.length >= 2 && qt.length <= 6 && initials.startsWith(qt)) inName = 0.9;
      const inAddr = wordMatch(qt, addrWords) * 0.7;
      const m = Math.max(inName, inAddr);
      if (m === 0) missing++;
      if (inName >= 0.7) inNameCount++;
      text += m;
    }
    text = (text / Math.max(qWords.length, 1)) * 60 + 12 * (inNameCount / Math.max(qWords.length, 1));
    const nName = norm(p.name), nQ = ctx.qNorm;
    if (nName === nQ) text += 22; else if (nName.startsWith(nQ)) text += 12;
    if (nName.length > nQ.length * 3 && nQ.length < 6) text -= 6; // very long names matching a short query
    text -= missing * 22;

    let type = TYPE_W[p.value] ?? (p.type === 'place' ? 10 : 2);
    if (p.type === 'highway') {
      if (ROAD_WORDS.test(ctx.qNorm)) type = ['footway', 'track', 'service', 'path', 'steps'].includes(p.value) ? -4 : 8;
      else type = ['bus_stop', 'platform'].includes(p.value) ? -4 : ['footway', 'track', 'service', 'path', 'steps'].includes(p.value) ? -14 : -5;
    }
    if (['apartments', 'house', 'yes', 'commercial', 'industrial', 'construction', 'residential'].includes(p.value) && p.type !== 'place') type -= 5;

    let prox = 0;
    for (const b of ctx.bias) {
      const km = haversine([b.lon, b.lat], [p.lon, p.lat]) / 1000;
      prox = Math.max(prox, b.w * (30 * Math.exp(-km / 25) + 12 * Math.exp(-km / 400)));
    }
    if (ctx.anchor) {
      const km = haversine([ctx.anchor.lon, ctx.anchor.lat], [p.lon, p.lat]) / 1000;
      prox += 45 * Math.exp(-km / 15) - (km > 60 ? 35 : 0);
    }
    const importance = (p._globalRank != null ? 14 * (1 - p._globalRank / 40) : 0) + 18 * (p.importance || 0);
    return text + type + prox + importance;
  }

  /* ---------- merge, rank, diversify ---------- */
  function merge(lists) {
    const out = [];
    for (const list of lists) for (const p of list) {
      const twin = out.find((o) => norm(o.name) === norm(p.name) && haversine([o.lon, o.lat], [p.lon, p.lat]) < (p.type === 'highway' || o.type === 'highway' ? 3000 : 400));
      if (twin) {
        if (p._globalRank != null) twin._globalRank = Math.min(twin._globalRank ?? 99, p._globalRank);
        twin.importance = Math.max(twin.importance || 0, p.importance || 0);
        if (!twin.osm && p.osm) twin.osm = p.osm;
        if (twin.type === 'highway' && p.type !== 'highway') { Object.assign(twin, { ...p, _globalRank: twin._globalRank }); }
      } else out.push(p);
    }
    return out;
  }
  /** Keep at most `perRegion` results with the same name per region, so ambiguous names show many cities. */
  function diversify(ranked, limit) {
    const seen = new Map(), out = [], rest = [];
    for (const p of ranked) {
      const key = norm(p.region || p.state) + '|' + norm(p.name).split(' ')[0];
      const n = seen.get(key) || 0;
      if (n < 2) { out.push(p); seen.set(key, n + 1); } else rest.push(p);
      if (out.length >= limit) break;
    }
    return out.length < limit ? [...out, ...rest].slice(0, limit) : out;
  }

  /**
   * Search for places.
   * @returns {Promise<{places: object[], parsed: {what, where}, anchor: object|null}>}
   */
  async function search(q, { limit = 8, full = false, signal } = {}) {
    const parsed = parse(q);
    let anchor = null;
    if (parsed.where) anchor = await resolveWhere(parsed.where, signal);
    const what = anchor ? parsed.what : q;
    const ctx = { qNorm: norm(what), qWords: norm(what).split(' ').filter(Boolean), bias: biasPoints(), anchor };
    const b = biasCenter();
    const jobs = [];
    if (anchor) {
      jobs.push(photon(what, { lat: anchor.lat, lon: anchor.lon, zoom: 12, scale: 1, limit: 30 }, signal));
      jobs.push(photon(`${what} ${anchor.name}`, {}, signal));
    } else {
      jobs.push(photon(q, { ...b, limit: 25 }, signal));
      // Unbiased: overall prominence, and other cities with the same name.
      jobs.push(photon(q, { limit: 40 }, signal).then((l) => l.map((p, i) => Object.assign(p, { _globalRank: i }))));
    }
    if (full) jobs.push(nominatim(anchor ? `${what}, ${anchor.name}` : q, anchor || (b.lat != null ? b : null), signal));
    const settled = await Promise.allSettled(jobs);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const lists = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    if (!lists.length) throw settled[0].reason;
    const merged = merge(lists);
    for (const p of merged) p._score = score(p, ctx);
    merged.sort((a, z) => z._score - a._score);
    return { places: diversify(merged, limit), parsed, anchor };
  }

  return { search, parse, resolveWhere, loadIpLocation, nearestCity, label, norm, get ipLoc() { return ipLoc; } };
})();
