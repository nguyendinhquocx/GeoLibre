import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { zipSync, strToU8 } from "fflate";
import type { FeatureCollection, Point } from "geojson";
import { MONTE_MARIO_ITALY_1 } from "./helpers/monte-mario-prj";

// shapefile-zip statically pulls in shpjs, whose bundle reads the browser
// `self` global at module-eval time; shim it before the dynamic import.
(globalThis as { self?: unknown }).self ??= globalThis;

let loadShapefileZip: (data: Uint8Array) => Promise<FeatureCollection>;
let writeShapefile: (geojson: FeatureCollection) => {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
};

before(async () => {
  ({ loadShapefileZip } = await import("../apps/geolibre-desktop/src/lib/file-io/shapefile-zip"));
  ({ writeShapefile } = await import("../apps/geolibre-desktop/src/lib/shapefile-writer"));
});

/** Metres between two lon/lat points (small distances). */
const metres = ([x1, y1]: number[], [x2, y2]: number[]) =>
  Math.hypot((x1 - x2) * 111320 * Math.cos((y1 * Math.PI) / 180), (y1 - y2) * 110950);

describe("loadShapefileZip with a national datum's .prj", () => {
  it("places a Monte Mario shapefile where PROJ does", async () => {
    // Rome, 12.4823 E 41.8955 N, in EPSG:3003 as PROJ 9.8.1 puts it (Monte
    // Mario to WGS 84 (4), the transformation the datum table uses).
    const parts = writeShapefile({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Roma" },
          geometry: { type: "Point", coordinates: [1788918.287, 4644051.469] },
        },
      ],
    });
    const zip = zipSync({
      "roma.shp": parts.shp,
      "roma.shx": parts.shx,
      "roma.dbf": parts.dbf,
      "roma.prj": strToU8(MONTE_MARIO_ITALY_1),
    });
    const fc = await loadShapefileZip(zip);
    const lonLat = (fc.features[0].geometry as Point).coordinates;
    // Without the datum shift, about 74 m off.
    assert.ok(metres(lonLat, [12.4823, 41.8955]) < 1, `${lonLat}`);
  });
});
