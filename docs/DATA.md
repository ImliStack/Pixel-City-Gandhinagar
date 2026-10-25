# Jaipur pilot data

The downloaded working extent is `[75.815, 26.915, 75.835, 26.935]` in `[west, south, east, north]` order, about **4.399 km²**. It is a working rectangle, not a city boundary. Hawa Mahal, City Palace, Jantar Mantar and Badi Chaupar are all present as named source features. The complete prepared dataset and its audit remain local.

## Reproduce without network

From the project root, after installing the pinned Python dependencies:

```sh
.venv/bin/python tools/data/fetch.py
.venv/bin/python tools/data/prepare.py
.venv/bin/python -m unittest discover -s tests -p 'test_data.py' -v
```

`fetch.py` verifies the cache's source and query hashes and returns without a network request. `--refresh` is required to replace it. Preparation, tests, rendering and viewing use local files. A missing cache permits one bounded Overpass query, with at most three attempts and 10/20 second backoff. The request identifies `JaipurPixelCity/0.1`, sets an 80 second server timeout and limits the downloaded body to 12 MiB. Client timeout is 100 seconds. Public queries larger than `0.0005` square degrees are rejected; expansion should use a local extract. Limits and bbox are in `config/data.json`.

The initial system Python TLS client failed before obtaining data. The system `curl` client completed the query; the fetch command now prefers that client and retains `urllib` as an alternative when curl is absent. No imagery service, map tile service, elevation download or supplemental footprint source was used.

## Source and outputs

The raw snapshot is `data/raw/pilot.overpass.json`: **1,880,443 bytes**, **3,141 elements**, OSM base timestamp **2026-10-24T17:59:33Z**. Its SHA-256 is:

```text
68b9f3abdd53300861f9f7bd6d4f07d84094b230842031b14d5f0bb276bea795
```

`data/raw/pilot.overpass.provenance.json` records endpoint, exact query, download time, hashes, bbox and license. Generated files are:

| File | Contents |
| --- | --- |
| `data/processed/pilot.geojson` | Preserved, repaired WGS84 source geometries and explicit render attributes |
| `data/processed/pilot.json` | Local metre coordinates, source/config hashes, POIs, bounds and full audit |
| `data/processed/audit.json` | Counts, height provenance, overlaps, coverage limitations and conflicts |
| `data/processed/coverage.svg` | North-up source coverage preview with courtyard holes and attribution |

Whole intersecting geometries are retained beyond the public coverage boundary to support consistent padded rendering and shadow casters. A long source road can extend much further than this bbox; it does **not** expand claimed coverage. The renderer must clip the displayed ground to the coverage boundary, and keep padding only for rendering support. The SVG preview explicitly clips geometry to the boundary.

## Audit of this actual snapshot

| Kind | Features |
| --- | ---: |
| Buildings | 2,033 |
| Roads/highway objects | 846 |
| Parks/gardens/green areas | 23 |
| Water | 4 |
| Individually mapped trees | 8 |
| Railway | 12 |
| Heritage/site areas | 16 |
| Other land use | 1 |
| Other point features | 198 |

Road counts include tagged highway points; only line/area geometry forms road surfaces. Green-area foliage added by the scene is a seeded artistic treatment inside verified green polygons, not a survey of individual tree locations.

**Height evidence is sparse.** One building uses an explicit height tag; 14 use parsed `building:levels × 3.2 m`; 2,018 use a flagged typology estimate. Fifteen buildings carry a levels tag, including the building whose explicit height takes priority. The height-tag fraction is 1/2,033 (0.049%), and levels-tag fraction is 15/2,033 (0.738%). These are attribute availability fractions, not map completeness claims. Contributor height values are not independently verified measurements. Estimates use 3.2 m for huts/sheds/roof shelters, 6.4 m for houses/retail/industrial buildings, 12.8 m for apartments, and 9.6 m for other unspecified buildings.

The snapshot has no invalid or missing geometries detected by preparation. No exact or relation-member duplicates occurred in this snapshot; tests exercise those cases using explicitly synthetic data. Building polygons cover about 371,657 m² of the pilot rectangle. That is **not** an estimate of how many real buildings are mapped.

There are two footprint intersections greater than 1 m²: `way/1257701014` overlaps `way/441461105` by 444.19 m² and `way/441461107` by 293.06 m². The first way is tagged `layer=-1`, while the other two are at the default layer. The original geometries remain intact and are audited as different-layer overlaps, with **zero same-layer overlap pairs**. The lower-layer building has `renderVisible=false` in the flat ground render. This is a rendering interpretation of relative layer ordering, not a claim about measured underground depth.

The source also has a substantive landmark conflict: Hawa Mahal point `node/542886858` at longitude 75.8268652, latitude 26.923932 lies inside a building relation `relation/1460207` named **Saraogi Mansion**. Both source records are preserved; no source label is silently corrected. The authored Hawa Mahal asset and any overlapping generic-geometry replacement must disclose this conflict. Its position is supported by the named point, while the conflicting footprint is not a surveyed monument outline.

Fifty-five unique named streets are available, including Tripolia Bazaar, Johari Bazar, Ramganj Bazaar, Gangauri Bazaar and Chandpol Bazaar. Street POIs use a midpoint along the covered part of a real source segment, not a guaranteed center of the entire named street. Landmark anchors likewise use a representative point inside the feature's intersection with the projected coverage polygon. Full scene geometries remain unchanged. Hindi values come from `name:hi` when present; curated landmark aliases/translations are UI labels.

Coverage is visibly uneven. For example, the source has no building polygons in `[75.815,26.9275,75.8175,26.93]`, `[75.8175,26.9275,75.82,26.93]`, and `[75.825,26.93,75.8275,26.9325]`. The audit lists more examples. These establish source sparsity; occupancy of each cell has not been independently verified. **Empty source space is left sparse.** No authoritative building inventory provides a defensible completeness denominator. Hills and DEM terrain are absent; the pilot assumes flat ground at z=0.

## Coordinates and geometry

Projection is WGS84 `EPSG:4326` to UTM zone 43N `EPSG:32643` with `always_xy=True`, so geographic inputs are always **longitude, latitude**. The fixed origin is longitude **75.825**, latitude **26.925**, projected easting **581908.4443302605 m**, northing **2978395.388423073 m**. Local axes are x=east, y=north, z=up. Subtract origin easting/northing after projection; never scale raw degrees as metres.

Multipolygon relations are assembled from outer/inner member lines. Courtyard rings remain holes. Invalid polygonal geometry is repaired with Shapely `make_valid`; non-polygonal remnants are discarded for building solids. Normalized exact geometry duplicates and same-kind relation-member duplicates are suppressed. A park boundary coincident with a separately tagged road retains the road. Source IDs seed deterministic scene variation.

The renderer owns camera basis, global image transform, pixel-origin convention and ground-point inverse. The same UTM origin must be used by markers and share links. A roof pixel cannot be uniquely converted to a ground coordinate without a height/terrain assumption.

## Local input

WGS84 GeoJSON is a first-class input. Geometry must be a `FeatureCollection`; each feature's properties can contain OSM-style tags directly or under `tags`. Stable `id`/`@id` values are preferred; otherwise a stable input-order ID is assigned. Unsupported explicit CRS declarations are rejected. Unknown local input is labeled as local input, and its original source license must be supplied and retained by the importer.

```sh
.venv/bin/python tools/data/prepare.py --input /path/to/local.geojson --output data/processed-local
```

For a local `.osm.pbf`, install the optional **osmium-tool** binary, then use the same input flag:

```sh
.venv/bin/python tools/data/prepare.py --input /path/to/rajasthan.osm.pbf --output data/processed-local
```

The PBF branch runs `osmium extract -s smart` on the configured bbox to retain complete ways and multipolygon relations, then exports the clipped extract to GeoJSON with original OSM type/ID attributes. Export stops on geometry errors instead of silently omitting broken geometry. It does not download a country extract. Input hashing is streamed in 1 MiB blocks. Temporary output needs free disk and osmium memory scales with the supplied extract: prefer an already regional extract. This optional branch is implemented but was not exercised here because no local PBF/osmium installation was provided. See the [official osmium extraction documentation](https://docs.osmcode.org/osmium/latest/osmium-extract.html) and [export documentation](https://docs.osmcode.org/osmium/latest/osmium-export.html). The actual GeoJSON branch is verified by the fixture test.

`tests/fixtures/geometry.geojson` is original synthetic CC0 test data for a courtyard, multipolygon, self-intersection, missing geometry and reversed-ring duplicate. It is **not Jaipur source data** and is never used in production preparation.

## License and provenance boundaries

OpenStreetMap data is distributed under **ODbL 1.0**. Retain source attribution and license information with the database and derivative database. The viewer and coverage preview display `© OpenStreetMap contributors` and the OSM copyright link. Publicly distributed rendered artwork is a produced work; its attribution requirements are distinct from the database obligations. If publishing modified OSM data or a work based on a derivative database, review ODbL's applicable share-alike/access provisions. Code licenses do not replace data licenses. See [OSM copyright](https://www.openstreetmap.org/copyright), [ODbL legal text](https://opendatacommons.org/licenses/odbl/1-0/) and [OSMF attribution guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

No Google Maps imagery, Open Buildings polygons, pretrained model weights or reference-site images are included in this data pipeline. Supplemental footprints would need explicit provenance, confidence filtering and duplicate reconciliation before becoming a separate supported input.

## Active capital extract (2026-10-25)

- Raw: `data/raw/gandhinagar-capital.overpass.json` (+ `.provenance.json`), bbox [72.645, 23.205, 72.675, 23.235], 2,584,388 bytes, sha256 `88ec05dd270f090b4e55befdd61baeaf9d50ea6a708d8725d01478228371b205`.
- Processed by `npm run audit-data` into `data/processed/capital/` (re-running reproduces `pilot.json` byte-identically). Audit: 2,183 buildings (1,351 levels-derived heights, 832 typology estimates, no measured heights), 1,061 roads, 49 parks, 4 water, 8 tree nodes; 2 unresolved same-layer overlaps, one of which (assembly ⊃ building:part way/338492244) is replaced by the authored focal model in art layers.
- Scene window: `npm run build-scene` → `outputs/capital/scene.json` (context radius 1200 m around local [-350, 450]). The rendered ground extent lies inside the acquisition bbox (tested).
- The VEDAS LoD1 parquet remains research-only and is not an input.
