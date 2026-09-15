# Mapbox renderer

Choose **View → Rendering engine → Mapbox** to render a project with Mapbox GL JS.
The engine is also available from the rendering-engine menu in each split pane.
MapLibre remains the default. Projects save the primary and secondary renderer
choices, and the Python and iframe APIs accept `mapbox` as a renderer name.

Paste your token into **Settings → Environment Variables → Mapbox token** and
click **Save Settings**. Like the Cesium token, it is stored on this device,
outside the project file. Existing enabled Mapbox environment-variable rows
move into this field when settings are saved; Cancel leaves them unchanged.
Alternatively, launch the development server with `MAPBOX_TOKEN` in its environment. Token changes
recreate Mapbox maps. A missing token displays setup instructions; map loading
errors redact access tokens. Use a public Mapbox token appropriate for your
application. Mapbox use is associated with that token's account and is subject
to Mapbox's terms and usage pricing.

New projects use Mapbox Standard by default for the Mapbox renderer. Open the
shared **Basemaps** panel from the Layers panel or Add Data to select Mapbox
styles (including Streets), public styles, or stacked raster basemaps. The
separate floating Mapbox selector has been removed.

A style selected in the Basemaps panel is saved as
`preferences.map.mapboxStyleUrl` while Mapbox is active, leaving the shared
MapLibre/Cesium background unchanged. All Mapbox panes share that choice.
Previously saved projects keep their selected styles. Provider credentials
come from Environment variables or the basemap control's API keys panel.

## Supported paths

- Native GeoJSON, including the vector importer's materialized data, with point,
  line, polygon, extrusion, label, data-driven color, opacity, and filter styles.
- Remote vector PMTiles archives through Mapbox GL JS’s native archive reader.
- LiDAR (LAS/LAZ, COPC) and standard 3D Tiles through deck.gl overlays.
- Deck.gl Layers built in **Add Data → Deck.gl Layer** (every kind in the
  builder, including the 3D Model scenegraph kind behind **Add Data → 3D
  Model**), plus the 3D Z-value and feature-diagram rendering of ordinary
  vector layers, through the same shared interleaved deck.gl overlay.
- DuckDB query layers from **Add Data → DuckDB**, drawn by the panel's own
  deck.gl overlay.
- Zarr layers from **Add Data → Zarr Layer**, STAC Zarr assets, and NetCDF/HDF
  or Kerchunk cubes with a time axis, drawn by `@carbonplan/zarr-layer` — a
  `CustomLayerInterface` implementation that targets Mapbox GL as well as
  MapLibre (globe and Mercator), added by the same Zarr control. Zarr Layer
  and STAC adds keep the current projection; local NetCDF/HDF cubes and
  Kerchunk references draw untiled in Web Mercator, so adding one switches the
  map to Mercator, as on MapLibre. A remote NetCDF/HDF URL renders its
  selected slice as an image overlay instead.
- HTTP(S) raster tiles (XYZ, WMS and WMTS), vector tiles with named source layers,
  and georeferenced image/video sources.
- Shared layer/group visibility, opacity and ordering; synchronized or independent
  split-view cameras; Mercator/globe projection and Mapbox terrain.
- Feature picking, selection highlighting, extent drawing, draggable placement,
  and engine-level image capture.
- The same default on-map controls as MapLibre, governed by the same
  **Controls** menu: fullscreen, the reset pitch & bearing compass beneath it,
  a globe/Mercator toggle, the scale bar (following the project's scale unit)
  and attribution, with navigation and geolocate available but off by default.
  Mapbox GL JS has no globe control of its own, so the engine mounts a
  stand-in (`packages/map/src/mapbox-globe-control.ts`) that mirrors MapLibre's
  button markup; clicking it persists the projection into project preferences
  as on MapLibre. Terrain is a scene setting here (the Controls menu toggles
  Mapbox terrain directly, without a button, as on Cesium). The attribution
  control cannot be hidden, Mapbox draws its own logo, and the Maptoolkit logo
  is MapLibre-only.
- The on-map layer control (`maplibre-gl-layer-control`), with the same
  per-layer visibility, opacity, zoom-to and style-editor round trip to the
  store as on MapLibre. The control only needs the shared style API, so both 2D
  engines drive it through one host (`packages/map/src/layer-control-host.ts`);
  a `mapbox://` style cannot be fetched by the control, so the engine seeds it
  with the loaded style's own layers to tell basemap from project layers.
  Toggle and reposition it from **Plugins → Layer Control**, as on MapLibre.
  Split panes never mount a second control.

Mapbox is not a full replacement for MapLibre's plugin ecosystem. Plugins must
explicitly declare `engines: ["mapbox"]` (or include it alongside other engines).
Unsupported plugins are disabled in the menu. `app.getMap()` stays MapLibre-only;
Mapbox-aware plugins use `app.getMapboxMap()` or the renderer-neutral app methods.
The vector import panel uses the existing store-based geometry bridge.

The offline (local PMTiles) basemap is MapLibre-only as well: its `pmtiles://`
source protocol is not registered with Mapbox, so a Mapbox pane whose project
basemap is an offline archive falls back to the default basemap (with a console
warning). Pick a Mapbox style from the shared Basemaps panel instead.
MapLibre custom protocols, tiled/streamed vector imports beyond the bridge's
materialization limits, custom COG terrain, and other plugin-owned layers
require additional adapters. Layers drawn with deck.gl need none:
`@deck.gl/mapbox` targets Mapbox GL JS natively, so the engine reports
`capabilities.deckOverlay` and the shared interleaved overlay binds to the
Mapbox map through `app.getMapboxMap()`. Visible unsupported layers report an error
on the map instead of being silently omitted. Advanced MapLibre-only symbology
(such as custom marker assets and blend modes) is not reproduced by this native
renderer. Mapbox Standard is loaded as a local style import with a shared opacity setting.
The Background card fades its land and water colors, labels (including ocean labels),
3D objects, and atmosphere while preserving project layers and Standard's configuration.

## License and terms

GeoLibre itself is MIT licensed, but the Mapbox renderer depends on
[Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js) v3 (`mapbox-gl`
3.30.0 at the time of writing), which is **not** open source. Mapbox GL JS v3
is distributed under the
[Mapbox Terms of Service](https://www.mapbox.com/legal/tos) and its
[license](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt);
it requires an active Mapbox account, may only be used with an access token
from that account and with the relevant Mapbox products, and its terms restrict
altering the SDK's billing, accounting and data-collection code. Usage-based
billing and Mapbox's attribution requirements depend on how the Mapbox services
are used under your account and the applicable terms; consult those terms before
enabling the renderer in a product. The SDK is a runtime dependency of
`@geolibre/map`, so npm consumers of that package and the desktop and web
distributions receive it even when MapLibre stays the active renderer, but no
Mapbox code runs (and no Mapbox service is contacted) until a Mapbox pane is
opened.

## Loading and size

Mapbox's JavaScript and CSS are imported only when a Mapbox pane mounts. The
production build gives them a separate chunk and excludes them from the PWA's
initial precache. MapLibre startup therefore does not download the Mapbox engine.
Desktop/web distribution artifacts still include it. With Mapbox GL JS 3.30.0,
the engine and stylesheet add approximately 1.91 MB raw, or 532 KB with gzip;
this excludes map tiles and other service responses.

## Add Data compatibility

The Add Data menu waits for Mapbox to finish loading before accepting an
import, so early clicks cannot lose a panel-opening request.

The Add Data menu and command palette withhold loaders that require an
unimplemented MapLibre protocol or custom render pass. These entries are
visible but disabled in the menu with a Mapbox compatibility hint: MBTiles
and Gaussian Splatting.
Cesium Ion and CZML scene loaders remain Cesium-only; KML / KMZ opens on every
renderer, going through the host KML importer (the drag-and-drop path) off the
globe.

Deck.gl Layer, 3D Model, and DuckDB are enabled: the first two render through
the shared interleaved deck.gl overlay (as 3D Tiles already did), the third
through the DuckDB panel's own deck.gl overlay. Like every deck.gl overlay they
hold the map in the Mercator projection while their layers are shown, so a
globe view snaps to Mercator when one is added. Deck.gl Layer data is stored
inline in the project, as on MapLibre. The DuckDB panel remounts on the live
map after a renderer swap; results that were only cached in the panel are
redrawn when it reopens, and a project-restored query layer needs its query
re-run, exactly as on MapLibre.

FlatGeobuf uses the shared vector importer on Mapbox. ArcGIS vector-tile
services retain their resolved tile sources, service styles, classification
filters, visibility, and opacity. STAC supports catalog browsing, extent
search, bbox drawing, footprints, and selection on both MapLibre and Mapbox;
remote vector PMTiles and Zarr assets can be added on either.

NetCDF/HDF files and directly readable remote files render a selected plane as
an image on both engines; cubes with a time axis, and Kerchunk references, go
through the Zarr renderer on Mapbox exactly as on MapLibre.

### Browser validation

The September 2026 audit opened every one of the 37 Add Data entries that was
enabled, checked the existing disabled entries, and exercised the public data
paths below with an authenticated Mapbox map. A mounted panel alone is not a
successful import; the table records the level of verification. Backend and
service restrictions are included explicitly.

| Panel | Result |
| --- | --- |
| Vector | US states GeoJSON: 52 features imported and rendered |
| Raster | Public DEM GeoTIFF: GPU raster displayed |
| Delimited Text | US cities CSV: 109 points imported and rendered |
| CAD | US states DXF: 58 entities discovered; EPSG:5070 import exercised |
| File Geodatabase | Panel opens; its local GDAL/sidecar workflow requires Desktop |
| Geotagged Photos | EXIF sample JPEG: one located photo imported |
| GPX | Fells Loop: 86 waypoints and one route; both native sources created |
| Encoded Polyline | Precision-5 sample: one line imported and rendered |
| MBTiles | Disabled: local custom protocol has no Mapbox adapter |
| OSM PBF | Monaco extract: 4,249 points, 4,002 lines, and 2,341 polygons imported and displayed |
| XYZ | USGS imagery sample: native raster source mounted |
| WMS | USGS NAIP sample: native raster source mounted |
| CSW Catalog | Open Canada catalog searched; Manitoba Economic Regions imported as eight GeoJSON features |
| WFS | MapServer continents service imported; the GeoServer sample was blocked by its remote service |
| WMTS | EOX Sentinel-2 cloudless sample: native raster source mounted |
| OGC API - Features | pygeoapi lakes sample: 25 features imported and rendered |
| OGC Vector Tiles | PDOK BGT sample: native vector-tile source mounted |
| ArcGIS | 4,186 city features rendered; Santa Monica parcels rendered using all seven service style layers |
| GeoRSS | USGS daily earthquake feed: 34 features imported (the live count changes) |
| STAC | Earth Search connected; 20 Sentinel-2 search footprints added |
| Video | Mapbox coastal video sample: native video source mounted |
| Deck.gl | Scatterplot sample (Manhattan points) rendered through the shared deck.gl overlay; visibility and opacity follow the layer store |
| GeoParquet | US states: 52 features imported and rendered |
| FlatGeobuf | Countries: 179 features imported through the shared vector bridge |
| PMTiles | Remote vector archives use native Mapbox sources; Tilezen’s nine source layers and Mapbox’s earthquake archive rendered |
| Zarr | CarbonPlan climate sample added through the panel: the custom layer mounts on the Mapbox map and loads its pyramid (6 levels, band/month axes). Checked without a paintable token, so pixel output was not confirmed; the renderer's Mapbox support is upstream's |
| NetCDF / HDF | Air-temperature file: selected time slice added as a native image |
| LiDAR | Autzen COPC rendered (10,653,336 archive points); the small PDAL COPC fixture loads 1,065 points |
| Gaussian Splatting | Panel opens; custom rendering unsupported and entry disabled |
| 3D Tiles | AGI headquarters tileset renders through deck.gl; altitude placement, visibility and restoration have regression coverage |
| Cesium Ion | Disabled: Cesium-only |
| CZML | Disabled: Cesium-only |
| KML / KMZ | Imported through the host KML importer as GeoJSON, ground-overlay, and model layers, the same path a dropped file takes |
| 3D Model | Shanghai sample model placed through the scenegraph builder |
| DuckDB | NYC sample database queried; the result layer rendered and survived a MapLibre → Mapbox renderer swap |
| PostgreSQL | Panel explains its Desktop/Martin requirement; no database connection tested |
| Apache Iceberg | Panel opens; no table/catalog connection supplied for an import |

An opt-in regression suite repeats the FlatGeobuf, ArcGIS vector-tile, STAC,
and menu-boundary checks in light and dark themes:

```bash
# Supply a public token in the environment before running.
npm exec -- playwright test e2e/mapbox-add-data.spec.ts
```

The tests skip when `MAPBOX_TOKEN` is absent. They use live public services;
remote-service availability is part of these integration checks.

### PMTiles and 3D adapters

The PMTiles panel keeps its archive discovery and source-layer selection UI, but
Mapbox imports go through the layer store. Each selected source layer has an
independent Mapbox source and editable style. This path supports remote HTTP(S)
**vector** archives whose URL path ends in `.pmtiles`; raster archives, local files,
and the offline PMTiles basemap remain unsupported and receive a load error.

LiDAR uses the existing point-cloud loader and its separate deck.gl canvas.
Standard 3D Tiles use the shared interleaved overlay, retaining the same project
source records as MapLibre. Both require Mercator. Tileset altitude offsets move
the geometry and traversal bounds together, so lowered tiles remain visible when
zooming in or reopening a saved project. The 3D Tiles panel reports loading and
fetch errors; visibility, opacity and removal follow the layer store.

The opt-in `e2e/mapbox-archives-3d.spec.ts` uses public PMTiles, COPC and AGI tileset
URLs and checks save/reopen in light and dark themes. Set `MAPBOX_TOKEN` at runtime,
then run it with `npx playwright test e2e/mapbox-archives-3d.spec.ts`.
Google Photorealistic and authenticated I3S services require their own credentials;
those services and every 3D Tiles extension are not covered by this test.
