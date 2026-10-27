# Natural Earth land

## 1:50m data

Public Domain: https://www.naturalearthdata.com/about/terms-of-use/

Source: https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_land.geojson

Pinned commit: `ca96624a56bd078437bca8184e78163e5039ad19`. Retrieved 2026-10-27.
Original SHA-256: `e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b`.

The raw 50m geometry was too expensive to reproject during navigation. It is
simplified offline with mapshaper **0.7.99**, weighted simplification **35%**,
`keep-shapes`; the tool reported 11 repaired intersections. This is display
generalization, never airport coordinates, physical routes or solar geometry.
No mapshaper dependency is installed in the project or shipped to the browser.

Simplified import SHA-256:
`6e1e4214480663e22014a9dddac585c0e51b01f62d2746501468a7e0efa0b60e`.
`scripts/import-coastline.mjs` checks this hash, normalizes spherical winding
for d3-geo and balances complete polygons across `coast-50m-*.json` chunks.
`land-50m.json` indexes them. Rings and holes are not split between chunks.

Reproduce from the repository root (temporary tools outside project):

```sh
npm ci
curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_land.geojson -o /tmp/ne_50m_land.geojson
sha256sum /tmp/ne_50m_land.geojson
npm install --prefix /tmp/coast-tools --ignore-scripts --no-audit --no-fund mapshaper@0.7.99
/tmp/coast-tools/node_modules/.bin/mapshaper /tmp/ne_50m_land.geojson -simplify 35% keep-shapes -o force format=geojson /tmp/ne_50m_land_simplified.geojson
node scripts/import-coastline.mjs /tmp/ne_50m_land_simplified.geojson
```

## Retained 1:110m data

Public Domain: https://www.naturalearthdata.com/about/terms-of-use/

Source: https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_land.geojson

Pinned commit: `ca96624a56bd078437bca8184e78163e5039ad19`. Retrieved 2026-10-26.

land-110m.json indexes the land-*.json chunks. Only Polygon/MultiPolygon coordinates are retained. The data is used for visual coastlines, never for simulation or airport suitability. No external map service is needed at runtime.
