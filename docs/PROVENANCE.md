# Provenance and rights

The app, map database, rendered pictures, reference pictures, fonts and optional model weights are separate materials. A permissive code license does not erase the others' conditions.

| Material | Source / provenance | Treatment |
| --- | --- | --- |
| Pilot geometry | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), bounded Overpass snapshot or user-supplied local file; fetch metadata and content hash accompany preparation output | ODbL 1.0. Keep source IDs/tags, acquisition time, query/extent and hashes. Raw and processed data are cached locally. |
| Generated scene database | OSM geometries, documented projection, height rules, explicit original landmark reconstruction | Retain data-source lineage and estimated-versus-tagged heights. Do not advertise a complete building census. |
| Deterministic artwork / pyramid | Original local scene rendered by Three.js and locally exported | Produced Work derived from OSM data. Visible OSM attribution in the viewer and attribution with exports are required; data obligations remain separate. |
| Authored monument details | Original parametric geometry; factual/form references in [REFERENCES.md](REFERENCES.md) | Artistic reconstructions, not measured heritage surveys. No reference photograph or upstream 3D model is included. |
| Upstream code references | Exact revisions and inspected files in [REFERENCES.md](REFERENCES.md) | No copied implementation source. Dependencies installed through npm/Python retain their own package notices and locks. |
| Reference website captures | `data/references/screenshots/` | Private local visual research only. Ignored by git, not viewer assets, not training examples. Do not infer image rights from source licenses. |
| Optional image-edit model | Official original [Qwen-Image-Edit model card](https://huggingface.co/Qwen/Qwen-Image-Edit/blob/ac7f9318f633fc4b5778c59367c8128225f1e3de/README.md) | Apache-2.0 declared for this exact candidate; no weights downloaded. Other Qwen revisions/products are not assumed to share this license. See [ART-STAGE.md](ART-STAGE.md). |
| Typography | Bundled DM Sans / Noto Sans Devanagari packages | Retain installed font license files. Viewer font requests remain local. |

[OSM copyright guidance](https://www.openstreetmap.org/copyright) requires attribution and a clear link to the data license. The [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) distinguishes a database from a Produced Work: a rendered picture is not automatically a database license grant. If publicly distributing a derivative database or using it publicly to produce a work, review the corresponding share-alike and machine-readable offer provisions (especially sections 4.3–4.6); preserve the prepared data and transformation instructions so these can be supplied. The current task is local operation, with no deployment or publication.

For image export, retain the adjacent metadata/provenance file. A separately circulated image must carry a visible caption such as **Map data © OpenStreetMap contributors · ODbL · https://www.openstreetmap.org/copyright**. Metadata alone may be lost when an image is copied. Technical masks used only for development are not presentation maps.

No Google Maps imagery, Google 3D tiles or hosted map raster is ingested into this pipeline. The reference projects' usage does not grant Jaipur such rights. [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms), including extraction/caching and ML-use restrictions, were consulted; alternative imagery ingestion is absent.

[Open Buildings](https://sites.research.google/gr/open-buildings/) is a possible later supplement, not current geometry. Its current footprint dataset supplies outlines, confidence and location, not facade detail or authoritative building height. Any future use needs a pinned release, its license notice, documented confidence filter, overlap reconciliation and source-priority policy. Do not double-extrude a supplemental footprint already represented in OSM.

[Geofabrik India](https://download.geofabrik.de/asia/india.html) was inspected for expansion: the current whole-country PBF is approximately 1.6 GB as displayed on 24 October 2026. It was not downloaded for this few-square-kilometre pilot. Obtain an appropriate regional/local PBF once, preserve its timestamp/hash and clip locally before expanding; avoid repeated whole-city Overpass queries.

The pilot is flat at ground z=0. No DEM has been loaded and ground elevation is never used as a building height. Hill and fort expansion requires a licensed terrain dataset, separate terrain provenance and a new projection/render validation.

Actual counts, invalid geometries, overlaps, tagged-height fractions and gaps belong in the generated audit files, not a guessed completeness percentage. The proposed bbox is a working extent, not an official Jaipur boundary. Height, roof detail, window placement and tree crowns can be estimated even where a mapped footprint is real.
