# Map

A free, open-source map app with a Google-Maps-style interface, built entirely on OpenStreetMap. It needs no API keys, no billing account and no build step.

## Features

- Search with live suggestions
- Place cards with address, opening hours, phone and website (when OpenStreetMap has them)
- One-tap nearby search: restaurants, coffee, hotels, gas, groceries, pharmacies, parks
- Directions for driving, cycling and walking, with alternative routes and turn-by-turn steps
- Draggable start and end pins
- Right-click (or long-press) menu: "What's here?", directions from/to here, measure distance
- Map styles: default, bright, light, dark and satellite
- Saved places (stored in the browser)
- Shareable links, plus a URL that keeps the current map position
- Mobile layout with a bottom sheet

## Run it

There's nothing to install; just serve the folder:

```sh
python3 -m http.server 5173
# open http://localhost:5173
```

Live at **https://map.itzsudhan.com**.

To deploy your own copy, upload the files to any static host (GitHub Pages, Netlify, Cloudflare). `wrangler.jsonc` is set up for Cloudflare Workers: run `npx wrangler deploy`.

## What it's built on

| Part | Service | Cost |
|---|---|---|
| Map rendering | [MapLibre GL JS](https://maplibre.org) | Free, open source |
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Free, no key |
| Search and reverse geocoding | [Photon](https://photon.komoot.io) by Komoot | Free public API |
| Nearby places | [Overpass API](https://overpass-api.de) (falls back to Photon) | Free public API |
| Directions | [OSRM](https://routing.openstreetmap.de) by FOSSGIS | Free public API |
| Satellite imagery | Esri World Imagery | See Esri's terms |

All endpoints are set in the `CONFIG` block at the top of `app.js`.

## Using it in a real product

The public search, Overpass and routing servers are run by volunteers for light use. They rate-limit heavy traffic, and Overpass is often busy. If your app gets real traffic, self-host them; it's all open source:

- **Tiles:** [Protomaps](https://protomaps.com) (one file, host on S3 or R2) or [OpenFreeMap self-hosted](https://github.com/hyperknot/openfreemap)
- **Search:** [Photon](https://github.com/komoot/photon) or [Nominatim](https://nominatim.org)
- **Routing:** [OSRM](https://github.com/Project-OSRM/osrm-backend), [Valhalla](https://github.com/valhalla/valhalla) or [GraphHopper](https://github.com/graphhopper/graphhopper)

Satellite imagery comes from Esri, whose terms limit commercial use. For a commercial app, swap in a licensed imagery provider or remove the satellite option.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL. You must keep the attribution visible on the map.

## License

MIT
