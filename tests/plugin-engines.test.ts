import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPluginEngineSupported } from "../packages/plugins/src/types";
import { maplibreArcGisHubPlugin } from "../packages/plugins/src/plugins/maplibre-arcgis-hub";
import { maplibreBasemapControlPlugin } from "../packages/plugins/src/plugins/maplibre-basemap-control";
import {
  maplibreCkanPlugin,
  maplibreSocrataPlugin,
} from "../packages/plugins/src/plugins/maplibre-open-data-catalogs";
import {
  maplibrePlanetOpenDataPlugin,
  maplibreStacCatalogsPlugin,
} from "../packages/plugins/src/plugins/maplibre-stac";
import {
  maplibreNaturalEarthPlugin,
  maplibreSourceCoopPlugin,
} from "../packages/plugins/src/plugins/maplibre-source-coop";
import { osmBasemapPlugin } from "../packages/plugins/src/plugins/osm-basemap";
import { cartoLightPlugin } from "../packages/plugins/src/plugins/carto-light";
import {
  isExternalPluginManifest,
  isPluginEngineList,
} from "../apps/geolibre-desktop/src/lib/plugin-archive-unpack";

describe("isPluginEngineSupported", () => {
  it("defaults to MapLibre support when engines is undefined", () => {
    const plugin = { id: "test", name: "Test", version: "1.0.0" };
    assert.equal(isPluginEngineSupported(plugin, "maplibre"), true);
    assert.equal(isPluginEngineSupported(plugin, "cesium"), false);
  });

  it("defaults to MapLibre support when engines is empty", () => {
    const plugin = { id: "test", name: "Test", version: "1.0.0", engines: [] };
    assert.equal(isPluginEngineSupported(plugin, "maplibre"), true);
    assert.equal(isPluginEngineSupported(plugin, "cesium"), false);
  });

  it("supports explicit single engine declaration", () => {
    const maplibreOnly = { id: "test", engines: ["maplibre" as const] };
    assert.equal(isPluginEngineSupported(maplibreOnly, "maplibre"), true);
    assert.equal(isPluginEngineSupported(maplibreOnly, "cesium"), false);

    const cesiumOnly = { id: "test", engines: ["cesium" as const] };
    assert.equal(isPluginEngineSupported(cesiumOnly, "maplibre"), false);
    assert.equal(isPluginEngineSupported(cesiumOnly, "cesium"), true);
  });

  it("supports multiple engines declaration", () => {
    const multi = { id: "test", engines: ["maplibre" as const, "cesium" as const] };
    assert.equal(isPluginEngineSupported(multi, "maplibre"), true);
    assert.equal(isPluginEngineSupported(multi, "cesium"), true);
  });

  it("returns default fallback gracefully when plugin is null or undefined", () => {
    assert.equal(isPluginEngineSupported(null, "maplibre"), true);
    assert.equal(isPluginEngineSupported(null, "cesium"), false);
    assert.equal(isPluginEngineSupported(undefined, "maplibre"), true);
    assert.equal(isPluginEngineSupported(undefined, "cesium"), false);
  });
});

describe("Tier 1 built-in plugin engine support audit", () => {
  const tier1Plugins = [
    maplibreSourceCoopPlugin,
    maplibreNaturalEarthPlugin,
    maplibreArcGisHubPlugin,
    maplibreSocrataPlugin,
    maplibreCkanPlugin,
    osmBasemapPlugin,
    cartoLightPlugin,
  ];

  it("declares support for both MapLibre and Cesium on all audited Tier 1 plugins", () => {
    for (const plugin of tier1Plugins) {
      assert.ok(plugin.engines, `Plugin ${plugin.id} must declare engines`);
      assert.deepEqual(
        plugin.engines,
        ["maplibre", "cesium"],
        `Plugin ${plugin.id} must declare ["maplibre", "cesium"]`,
      );
      assert.equal(isPluginEngineSupported(plugin, "maplibre"), true);
      assert.equal(isPluginEngineSupported(plugin, "cesium"), true);
    }
  });

  it("declares support for MapLibre only on BasemapControl plugin", () => {
    assert.deepEqual(maplibreBasemapControlPlugin.engines, ["maplibre"]);
    assert.equal(isPluginEngineSupported(maplibreBasemapControlPlugin, "maplibre"), true);
    assert.equal(isPluginEngineSupported(maplibreBasemapControlPlugin, "cesium"), false);
  });

  // Both STAC plugins come out of the same createStacPlugin factory, so they
  // are audited together: the panel is engine-neutral, but footprints, the
  // "current view" search bbox, the draw-bbox tool, and footprint click/hover
  // all need app.getMap(), which only MapLibre provides.
  it("declares support for MapLibre only on the STAC catalog plugins", () => {
    for (const plugin of [maplibreStacCatalogsPlugin, maplibrePlanetOpenDataPlugin]) {
      assert.deepEqual(plugin.engines, ["maplibre"], `Plugin ${plugin.id} must be MapLibre-only`);
      assert.equal(isPluginEngineSupported(plugin, "maplibre"), true);
      assert.equal(isPluginEngineSupported(plugin, "cesium"), false);
    }
  });

  it("defaults MapLibre-only plugins without explicit engines to maplibre", () => {
    const defaultPlugin = { id: "plain-plugin", name: "Plain", version: "1.0.0" };
    assert.equal(isPluginEngineSupported(defaultPlugin, "maplibre"), true);
    assert.equal(isPluginEngineSupported(defaultPlugin, "cesium"), false);
  });
});

describe("isExternalPluginManifest engines validation", () => {
  const baseManifest = {
    id: "custom-plugin",
    name: "Custom Plugin",
    version: "1.0.0",
    entry: "dist/index.js",
  };

  it("accepts manifests without engines", () => {
    assert.equal(isExternalPluginManifest(baseManifest), true);
  });

  it("accepts manifests with valid engines list", () => {
    assert.equal(isExternalPluginManifest({ ...baseManifest, engines: ["maplibre"] }), true);
    assert.equal(isExternalPluginManifest({ ...baseManifest, engines: ["cesium"] }), true);
    assert.equal(
      isExternalPluginManifest({ ...baseManifest, engines: ["maplibre", "cesium"] }),
      true,
    );
  });

  it("rejects plugin engines that are not a list of known renderers", () => {
    assert.equal(isPluginEngineList(["maplibre", "cesium"]), true);
    assert.equal(isPluginEngineList([]), true);
    assert.equal(isPluginEngineList("maplibre"), false);
    assert.equal(isPluginEngineList(["unsupported"]), false);
    assert.equal(isPluginEngineList([123]), false);
    assert.equal(isPluginEngineList(undefined), false);
  });

  it("rejects manifests with invalid engines", () => {
    assert.equal(
      isExternalPluginManifest({ ...baseManifest, engines: "maplibre" as unknown }),
      false,
    );
    assert.equal(
      isExternalPluginManifest({
        ...baseManifest,
        engines: ["unsupported" as unknown as "maplibre"],
      }),
      false,
    );
    assert.equal(
      isExternalPluginManifest({ ...baseManifest, engines: [123 as unknown as "maplibre"] }),
      false,
    );
  });
});
