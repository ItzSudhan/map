# Map

A free, open-source map app with a Google-Maps-style interface, built entirely on open data and free services. It needs no API keys, no billing account and no build step.

**Live at https://map.itzsudhan.com**

## Features

### Search
- Live suggestions as you type, ranked using name match, typo tolerance, place importance and distance to you
- Understands "X in Y" queries: "mansarovar in jaipur", "cafes in jaipur", "mg road, bangalore"
- Handles typos, Indian spelling variants (sarovar/sarowar), old city names (Bangalore→Bengaluru, Bombay→Mumbai) and abbreviations (IIT, AIIMS)
- Clear labels such as "Jaipur, Rajasthan", and ambiguous names show results from different cities
- Category shortcuts ("coffee near me", "petrol pump"), coordinate search ("28.6129, 77.2295"), recent searches and voice search
- Remembers your last view and uses your location (GPS if allowed, otherwise a rough IP location) to rank results

### Places
- Place cards with photos (Wikipedia and Wikimedia Commons), a Wikipedia summary, address, opening hours with an **Open now / Closed** badge, phone, website, cuisine and payment details
- Live weather, air quality (AQI), sunrise/sunset and local time
- Street View preview, "Explore nearby" attractions, plus code and elevation
- Full-screen photo viewer, plus a **360° viewer** for panoramic photos
- Save places to lists (Favourites, Want to go, custom) with notes
- Share sheet with QR code, WhatsApp, X and email; embed code for websites

### Directions & navigation
- Driving, cycling and walking with alternative routes, arrival times and turn-by-turn steps
- Up to 5 stops, draggable start/stop/end pins, and options to avoid tolls, highways or ferries
- Elevation profile for walking and cycling routes
- **Turn-by-turn navigation** with voice guidance, next-turn banner, live ETA, automatic rerouting and a demo mode ("Preview")
- Shareable route links

### Street View
- Street-level photos from KartaView: blue coverage lines, click anywhere to look around, step along the street, mini-map with your heading
- 360° street photos where available

### Map
- Five base styles (default, bright, light, dark, satellite) with live previews; click the tile to switch between map and satellite, as in Google Maps
- 3D buildings and tilt, 3D terrain with hillshading, globe view, compass
- Overlays: live rain radar (animated), cycle lanes, railways, hiking and cycling routes, Wikipedia places
- Live location with follow mode and heading

### Tools
- **My Maps:** draw pins, lines and areas (with length and area), keep several maps, import/export GPX, KML and GeoJSON
- "How far can I go?" travel-time areas (isochrones) for car, bike and walking
- Measure distance, distance rings, coordinate formats (decimal, DMS, UTM, geohash)
- Download the map as an image, or print it
- Report a map problem straight to OpenStreetMap
- Keyboard shortcuts (press `?`), embeddable map (`?embed=1`), installable as an app (PWA) with an offline app shell
- Google Material Symbols icons, smooth animations, dark mode, and a draggable bottom sheet on phones

## Run it

There's nothing to install; just serve the folder:

```sh
python3 -m http.server 5173
# open http://localhost:5173
```

### Deploy

`wrangler.jsonc` is set up for Cloudflare Workers static assets:

```sh
npx wrangler deploy
```

Any static host works too (GitHub Pages, Netlify, Cloudflare Pages).

If you add new icons, run `python3 scripts/update-icons.py`. It rebuilds the Material Symbols font link so it includes only the icons the app uses.

## Code layout

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page layout and styles |
| `app.js` | Core app: map, place cards, suggestions UI, directions, layers, menus |
| `search.js` | Search engine: multi-source querying and ranking |
| `extras.js` | Place details: photos, Wikipedia, weather, open-now, nearby, photo viewer |
| `mapx.js` | 3D, terrain, globe, compass, fullscreen, location tracking, shortcuts, embed, PWA |
| `streetview.js` | Street View and the 360° viewer |
| `navigation.js` | Turn-by-turn navigation |
| `overlays.js` | Radar, cycling, railway, hiking and Wikipedia overlays |
| `tools.js` | Isochrones, elevation, image/print, QR share, voice search, reports, coordinates, rings |
| `mymaps.js` | My Maps drawing, import/export, saved lists |
| `sheet.js` | Mobile bottom sheet |
| `sw.js`, `manifest.webmanifest` | Installable app and offline shell |

## What it's built on

| Part | Service | Cost |
|---|---|---|
| Map rendering | [MapLibre GL JS](https://maplibre.org) | Free, open source |
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Free, no key |
| Search | [Photon](https://photon.komoot.io) by Komoot and [Nominatim](https://nominatim.org) | Free public APIs |
| Place details | [Overpass API](https://overpass-api.de), [Wikipedia](https://www.wikipedia.org), [Wikidata](https://www.wikidata.org), [Wikimedia Commons](https://commons.wikimedia.org) | Free |
| Directions | [OSRM](https://routing.openstreetmap.de) and [Valhalla](https://valhalla1.openstreetmap.de) by FOSSGIS | Free public APIs |
| Street View | [KartaView](https://kartaview.org) (CC BY-SA 4.0) | Free |
| 360° viewer | [Pannellum](https://pannellum.org) | Free, open source |
| Weather, air quality, elevation | [Open-Meteo](https://open-meteo.com) | Free for non-commercial use |
| Rain radar | [RainViewer](https://www.rainviewer.com) | Free for personal/educational use |
| Overlays | [CyclOSM](https://www.cyclosm.org), [OpenRailwayMap](https://www.openrailwaymap.org), [Waymarked Trails](https://waymarkedtrails.org) | Free |
| Terrain | Mapzen terrain tiles on AWS Open Data | Free |
| Satellite imagery | Esri World Imagery | See Esri's terms |
| Icons | [Material Symbols](https://fonts.google.com/icons) by Google | Free, Apache 2.0 |

## Using it in a real product

The public search, routing and data servers are run by volunteers and non-profits for light use, and they rate-limit heavy traffic. If your app gets real traffic, self-host them; it's all open source:

- **Tiles:** [Protomaps](https://protomaps.com) (one file, host on S3 or R2) or [OpenFreeMap self-hosted](https://github.com/hyperknot/openfreemap)
- **Search:** [Photon](https://github.com/komoot/photon) or [Nominatim](https://nominatim.org)
- **Routing:** [OSRM](https://github.com/Project-OSRM/osrm-backend), [Valhalla](https://github.com/valhalla/valhalla) or [GraphHopper](https://github.com/graphhopper/graphhopper)

Some services restrict commercial use: Esri satellite imagery, RainViewer radar (personal/educational only) and Open-Meteo (non-commercial free tier). For a commercial app, swap them for licensed providers or remove them.

Search and place data can only be as complete as OpenStreetMap. There are no reviews or live traffic, and shop/business coverage is thinner than Google's in many cities. You can help by [adding missing places to OpenStreetMap](https://www.openstreetmap.org/fixthemap).

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL. Keep the attribution visible on the map.

## License

MIT
