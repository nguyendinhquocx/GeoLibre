import {
  compileLayerFilters,
  labelFieldTextField,
  ruleBasedVisibilityFilter,
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
} from "@geolibre/core";
import type {
  DataDrivenPropertyValueSpecification,
  LayerSpecification,
  SourceSpecification,
  FilterSpecification,
} from "mapbox-gl";
import { circlePaint, fillPaint, fillExtrusionPaint, linePaint, rasterPaint } from "./style-mapper";
import { proxyWmsTiles } from "./wms-proxy";

export interface MapboxLayerPlan {
  sourceId: string;
  source: SourceSpecification;
  layers: LayerSpecification[];
}

/** MapLibre's extra compositing properties are not in Mapbox's Style Spec. */
export function mapboxPaint(paint: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(paint).filter(
      ([key, value]) => !key.endsWith("-layer-opacity") && value != null,
    ),
  );
}

function supportedUrl(value: string): boolean {
  return !/^[\w+-]+:/.test(value) || /^(https?:|mapbox:|data:|blob:)/.test(value);
}

/**
 * Whether an inline style's sources all use URLs Mapbox can fetch. GeoLibre's
 * offline basemap builds a `pmtiles://` source, and that protocol is only ever
 * registered with maplibre-gl, so such a style would silently fail to load in
 * a Mapbox pane.
 */
export function styleUsesUnsupportedSource(style: { sources?: object }): boolean {
  return Object.values(style.sources ?? {}).some((source: unknown) => {
    // `data` is a GeoJSON source's external URL when it is a string.
    const { url, tiles, data } = (source ?? {}) as {
      url?: unknown;
      tiles?: unknown;
      data?: unknown;
    };
    const urls = [url, data, ...(Array.isArray(tiles) ? tiles : [])];
    return urls.some((value) => typeof value === "string" && !supportedUrl(value));
  });
}

/**
 * Whether Mapbox can draw a layer through a native plan or the raster plugin.
 * The layer panels use it to badge unsupported layers before the engine's
 * error banner would report them.
 */
export function isMapboxSupportedLayer(layer: GeoLibreLayer): boolean {
  if (isMapboxPluginRaster(layer)) return true;
  const cached = supportedLayerCache.get(layer);
  if (cached !== undefined) return cached;
  let supported = true;
  try {
    compileMapboxLayer(layer);
  } catch {
    supported = false;
  }
  supportedLayerCache.set(layer, supported);
  return supported;
}

/** The raster plugin mounts its GPU overlay or TiTiler layer on Mapbox itself. */
export function isMapboxPluginRaster(layer: GeoLibreLayer): boolean {
  return (
    layer.type === "cog" &&
    layer.metadata.sourceKind === "maplibre-gl-raster" &&
    layer.metadata.externalNativeLayer === true
  );
}

// Store layers are immutable records (every edit creates a new object), so the
// answer is memoized per object: the layer panels ask on every render, and a
// full compile per layer per render would be wasted work.
const supportedLayerCache = new WeakMap<GeoLibreLayer, boolean>();

/** Options the engine derives from the loaded basemap style. */
export interface CompileMapboxLayerOptions {
  /**
   * Font stack for label layers. Mapbox's hosted styles all serve this default
   * from Mapbox's glyph catalog; the engine passes the active basemap's own
   * font instead (`resolveTextFontFromStyleLayers` in text-font.ts) so labels still
   * render on a third-party basemap whose glyphs do not include it.
   */
  textFont?: string[];
}

export const DEFAULT_MAPBOX_TEXT_FONT = ["Open Sans Regular"];

/** Compile only native Mapbox sources. Never hand MapLibre protocol URLs to its workers. */
export function compileMapboxLayer(
  layer: GeoLibreLayer,
  compileOptions: CompileMapboxLayerOptions = {},
): MapboxLayerPlan {
  const sourceId = `geolibre-mapbox-${layer.id}`;
  const style = { ...DEFAULT_LAYER_STYLE, ...layer.style };
  const layout = { visibility: layer.visible ? ("visible" as const) : ("none" as const) };
  const zoom = { minzoom: style.minZoom, maxzoom: style.maxZoom };
  const filters = [
    compileLayerFilters(layer),
    layer.timeFilter,
    layer.embedFilter,
    ruleBasedVisibilityFilter(layer.style),
  ].filter(Boolean);
  const filter = filters.length ? ["all", ...filters] : null;
  // `["geometry-type"]` evaluates to the Multi* variant for multi-geometries,
  // so match both (as layer-sync.ts does) or a MultiPolygon never gets a fill.
  const geometryFilter = (geometry: string): FilterSpecification => {
    const isGeometry = ["match", ["geometry-type"], [geometry, `Multi${geometry}`], true, false];
    return (filter ? ["all", isGeometry, filter] : isGeometry) as FilterSpecification;
  };
  const notPoint = ["match", ["geometry-type"], ["Point", "MultiPoint"], false, true];
  const vectorLayers = (sourceLayer?: string): LayerSpecification[] => {
    const base = {
      source: sourceId,
      layout,
      ...zoom,
      ...(sourceLayer ? { "source-layer": sourceLayer } : {}),
    };
    const id = `${sourceId}-${sourceLayer ?? "geojson"}`;
    // The shared paint compiler produces Style Spec expressions. Conversion is
    // confined here; the engine never masquerades as a MapLibre Map instance.
    const result = [
      {
        ...base,
        id: `${id}-fill`,
        type: style.extrusionEnabled ? "fill-extrusion" : "fill",
        filter: geometryFilter("Polygon"),
        paint: mapboxPaint(
          style.extrusionEnabled
            ? fillExtrusionPaint(style, layer.opacity)
            : fillPaint(style, layer.opacity),
        ),
      },
      {
        ...base,
        id: `${id}-line`,
        type: "line",
        filter: (filter ? ["all", notPoint, filter] : notPoint) as FilterSpecification,
        paint: mapboxPaint(linePaint(style, layer.opacity)),
      },
      {
        ...base,
        id: `${id}-circle`,
        type: "circle",
        filter: geometryFilter("Point"),
        paint: mapboxPaint(circlePaint(style, layer.opacity)),
      },
    ] as LayerSpecification[];
    const labels = style.labels;
    if (labels.enabled && (labels.field || labels.expression)) {
      let text: DataDrivenPropertyValueSpecification<string> = labelFieldTextField(
        labels,
      ) as DataDrivenPropertyValueSpecification<string>;
      if (labels.expression.trim()) {
        try {
          text = JSON.parse(labels.expression) as DataDrivenPropertyValueSpecification<string>;
        } catch {
          // An unparseable label expression must not take the geometry with
          // it; keep the field-based text.
        }
      }
      result.push({
        ...base,
        id: `${id}-labels`,
        type: "symbol",
        ...(filter ? { filter: filter as FilterSpecification } : {}),
        minzoom: Math.max(style.minZoom, labels.minZoom),
        maxzoom: Math.min(style.maxZoom, labels.maxZoom),
        layout: {
          ...layout,
          "text-field": text,
          "text-font": compileOptions.textFont ?? DEFAULT_MAPBOX_TEXT_FONT,
          "text-size": labels.size,
          "symbol-placement": labels.placement,
          "text-allow-overlap": labels.allowOverlap,
          "text-anchor": labels.anchor,
          "text-offset": [labels.offsetX, labels.offsetY],
          "text-rotate": labels.rotation,
          "text-max-width": labels.maxWidth,
          "text-transform": labels.transform,
        },
        paint: {
          "text-color": labels.color,
          "text-halo-color": labels.haloColor,
          "text-halo-width": labels.haloWidth,
          "text-opacity": layer.opacity,
        },
      });
    }
    return result;
  };
  if (layer.geojson) {
    return {
      sourceId,
      source: { type: "geojson", data: layer.geojson, generateId: true },
      layers: vectorLayers(),
    };
  }
  const urls = [
    layer.source.url,
    ...(Array.isArray(layer.source.tiles) ? layer.source.tiles : []),
    ...(Array.isArray(layer.source.urls) ? layer.source.urls : []),
  ];
  if (urls.some((url) => typeof url === "string" && !supportedUrl(url))) {
    throw new Error("MapLibre custom tile protocols are not supported by Mapbox");
  }
  const url = typeof layer.source.url === "string" ? layer.source.url : undefined;
  const tiles = Array.isArray(layer.source.tiles)
    ? layer.source.tiles.filter((t): t is string => typeof t === "string")
    : [];
  const options = {
    ...(typeof layer.source.minzoom === "number" ? { minzoom: layer.source.minzoom } : {}),
    ...(typeof layer.source.maxzoom === "number" ? { maxzoom: layer.source.maxzoom } : {}),
    ...(typeof layer.source.attribution === "string"
      ? { attribution: layer.source.attribution }
      : {}),
    ...(Array.isArray(layer.source.bounds) && layer.source.bounds.length === 4
      ? { bounds: layer.source.bounds as [number, number, number, number] }
      : {}),
    ...(layer.source.scheme === "tms" ? { scheme: "tms" as const } : {}),
  };
  if (layer.type === "vector-tiles" && (url || tiles.length)) {
    const names = Array.isArray(layer.source.sourceLayers ?? layer.metadata.sourceLayers)
      ? ((layer.source.sourceLayers ?? layer.metadata.sourceLayers) as unknown[])
      : [layer.source.sourceLayer ?? layer.source["source-layer"]];
    const sourceLayers = names.filter((v): v is string => typeof v === "string" && Boolean(v));
    if (!sourceLayers.length) throw new Error("Vector tiles need a source-layer name");
    return {
      sourceId,
      source: { type: "vector", ...(url ? { url } : { tiles }), ...options },
      layers: sourceLayers.flatMap(vectorLayers),
    };
  }
  const rasterLayers = [
    {
      id: `${sourceId}-raster`,
      type: "raster",
      source: sourceId,
      layout,
      ...zoom,
      paint: mapboxPaint(rasterPaint(style, layer.opacity)),
    },
  ] as LayerSpecification[];
  if (["raster", "wms", "wmts", "xyz"].includes(layer.type) && (tiles.length || url)) {
    // Same dev-server WMS proxy as the MapLibre path (getRenderableRasterTiles),
    // so a WMS layer that works in a MapLibre pane also works here in `npm run dev`.
    const rasterTiles = proxyWmsTiles(layer.type, tiles);
    return {
      sourceId,
      source: {
        type: "raster",
        ...(rasterTiles.length ? { tiles: rasterTiles } : { url }),
        tileSize: typeof layer.source.tileSize === "number" ? layer.source.tileSize : 256,
        ...options,
      },
      layers: rasterLayers,
    };
  }
  if (layer.type === "geojson" && url) {
    return {
      sourceId,
      source: { type: "geojson", data: url, generateId: true },
      layers: vectorLayers(),
    };
  }
  if (
    (layer.type === "image" || layer.type === "video") &&
    Array.isArray(layer.source.coordinates)
  ) {
    const coordinates = layer.source.coordinates as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    if (
      coordinates.length !== 4 ||
      coordinates.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
    )
      throw new Error("Invalid image corners");
    if (layer.type === "image" && url)
      return { sourceId, source: { type: "image", url, coordinates }, layers: rasterLayers };
    if (layer.type === "video" && Array.isArray(layer.source.urls))
      return {
        sourceId,
        source: { type: "video", urls: layer.source.urls as string[], coordinates },
        layers: rasterLayers,
      };
  }
  throw new Error(`Layer type ${layer.type} requires a renderer-specific adapter`);
}
