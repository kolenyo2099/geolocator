# Self-hosted front-end bundles

The application no longer pulls critical JavaScript and CSS bundles from CDNs. The following assets are vendored under `assets/vendor/` so the drawing tools and supporting map features continue working even when external CDNs are blocked.

| Library | Local path | Upstream download URL |
| --- | --- | --- |
| Leaflet 1.9.4 (CSS/JS) | `assets/vendor/leaflet/leaflet.css`, `assets/vendor/leaflet/leaflet.js` | https://unpkg.com/leaflet@1.9.4/dist/ |
| Leaflet marker & control icons | Embedded as base64 data URIs in `assets/vendor/leaflet/leaflet.css`, `assets/vendor/leaflet/leaflet.js`, and `assets/js/icons.js` | https://unpkg.com/leaflet@1.9.4/dist/images/ |
| Leaflet Rotate 0.2.8 | `assets/vendor/leaflet-rotate/leaflet-rotate-src.js` | https://unpkg.com/leaflet-rotate@0.2.8/dist/ |
| Leaflet Geoman Free 2.14.2 | `assets/vendor/leaflet-geoman/leaflet-geoman.css`, `assets/vendor/leaflet-geoman/leaflet-geoman.min.js` | https://unpkg.com/@geoman-io/leaflet-geoman-free@2.14.2/dist/ |
| Turf.js 6.x | `assets/vendor/turf/turf.min.js` | https://unpkg.com/@turf/turf@6/ |
| Leaflet Control Geocoder | `assets/vendor/leaflet-control-geocoder/Control.Geocoder.css`, `assets/vendor/leaflet-control-geocoder/Control.Geocoder.js` | https://unpkg.com/leaflet-control-geocoder/dist/ |
| Leaflet MarkerCluster 1.5.3 | `assets/vendor/leaflet-markercluster/*` | https://unpkg.com/leaflet.markercluster@1.5.3/dist/ |
| Mapbox GL JS 2.15.0 | `assets/vendor/mapbox-gl/*` | https://api.mapbox.com/mapbox-gl-js/v2.15.0/ |
| Konva 9.x | `assets/vendor/konva/konva.min.js` | https://unpkg.com/konva@9/ |
| Mapillary JS 4.1.2 | `assets/vendor/mapillary/mapillary.css`, `assets/vendor/mapillary/mapillary.js` | https://unpkg.com/mapillary-js@4.1.2/dist/ |

Only the PeakFinder integration still loads from its vendor script (the service requires their hosted bundle).

## Marker artwork

Leaflet's default blue marker, its retina/high-DPI variant, the drop shadow sprite, and the layers control icons are stored inline as base64-encoded data URIs so no binary PNGs need to be tracked in the repository. The custom colored pins used by places and line-of-sight modes live in `assets/js/icons.js`, which exposes helpers to create fully self-hosted `L.icon` instances without requesting external assets.
