import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { writeArrayBuffer } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import { initTools } from "geolibre-wasm/tools";
import proj4 from "proj4";
import {
  datumShiftFor,
  installCogTilerDatumShift,
  withDatumShift,
  withGeoKeysDatumShift,
  withWktDatumShift,
} from "@geolibre/core";
import { polygonizeLabels } from "@geolibre/processing";
import { datumShiftEpsgResolver } from "../packages/plugins/src/plugins/epsg-datum-resolver";
import { MONTE_MARIO_ITALY_1 } from "./helpers/monte-mario-prj";

/** The British National Grid as the EPSG tables give it (no datum shift). */
const bng = () =>
  (toProj4({ ProjectedCSTypeGeoKey: 27700 } as never).proj4 ?? "").replace(/\+axis=\w+\s*/g, "");

/** Metres between two lon/lat points (small distances). */
const metres = ([x1, y1]: number[], [x2, y2]: number[]) =>
  Math.hypot((x1 - x2) * 111320 * Math.cos((y1 * Math.PI) / 180), (y1 - y2) * 111320);

// PROJ (pyproj 3, best available OSGB36 to WGS84 transformation) for the
// British National Grid point (292100, 329590).
const PROJ_LONLAT = [-3.6038184838898335, 52.85297290276153];

describe("datum shifts", () => {
  it("adds the British National Grid's shift, which the EPSG tables leave out", () => {
    const raw = bng();
    assert.doesNotMatch(raw, /towgs84/);
    const shifted = withDatumShift(raw, 27700);
    assert.match(shifted, /\+towgs84=446\.448,-125\.157,542\.06/);
    // Without the shift proj4 is about 86 m off; with it, within 2 m (PROJ uses
    // the finer OSTN15 grid).
    const plain = proj4(raw, "EPSG:4326", [292100, 329590]);
    const fixed = proj4(shifted, "EPSG:4326", [292100, 329590]);
    assert.ok(metres(plain, PROJ_LONLAT) > 80);
    assert.ok(metres(fixed, PROJ_LONLAT) < 2);
  });

  it("shifts the other CRSs on a listed datum, not only its main grid", () => {
    // PROJ 9.8.1 (pyproj 3.8, best available transformation) for the centre of
    // each CRS's area of use: the projected point and the lon/lat it maps to.
    const cases: [number, number[], number[]][] = [
      [5659, [657266.278, 922283.48], [10.975, 44.435]], // Monte Mario / TM Emilia-Romagna
      [5676, [2547649.712, 5703045.701], [6.685, 51.46]], // DHDN / 3-degree GK zone 2 (E-N)
      [5677, [3500423.031, 5671670.91], [9.005, 51.18]], // zone 3 (E-N)
      [5678, [4500456.637, 5650531.068], [12.005, 50.99]], // zone 4 (E-N)
      [5679, [5402325.267, 5401677.636], [13.67, 48.745]], // zone 5 (E-N)
      [21782, [160449.469, 25945.462], [9.555, 47.165]], // CH1903 / LV03C-G
      [28991, [-12107.807, 7783.867], [5.21, 52.225]], // Amersfoort / RD Old
    ];
    for (const [code, xy, lonLat] of cases) {
      const raw = (toProj4({ ProjectedCSTypeGeoKey: code } as never).proj4 ?? "").replace(
        /\+axis=\w+\s*/g,
        "",
      );
      assert.notEqual(raw, "", `EPSG:${code} has no proj4 definition`);
      assert.doesNotMatch(raw, /towgs84/, `EPSG:${code}`);
      // 75 to 180 m off without the shift, within 2 m with it (the documented tolerance).
      assert.ok(metres(proj4(raw, "EPSG:4326", xy), lonLat) > 70, `EPSG:${code}`);
      assert.ok(
        metres(proj4(withDatumShift(raw, code), "EPSG:4326", xy), lonLat) < 2,
        `EPSG:${code}`,
      );
    }
  });

  it("adds the shift to a .prj's WKT by datum name, ESRI or OGC", () => {
    assert.ok(
      withWktDatumShift(MONTE_MARIO_ITALY_1).includes(
        'SPHEROID["International_1924",6378388.0,297.0],TOWGS84[-104.1,-49.1,-9.9,',
      ),
    );
    // OGC names, and a spheroid with its own AUTHORITY node.
    const ogc =
      'GEOGCS["Amersfoort",DATUM["Amersfoort",SPHEROID["Bessel 1841",6377397.155,' +
      '299.1528128,AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6289"]],PRIMEM["Greenwich",0]]';
    assert.ok(withWktDatumShift(ogc).includes('AUTHORITY["EPSG","7004"]],TOWGS84[565.417,'));
    assert.ok(
      withWktDatumShift(
        'GEOGCS["x",DATUM["Reseau_National_Belge_1972",SPHEROID["a",1,2]]]',
      ).includes("TOWGS84[-106.8686,"),
    );
    // Left alone: a TOWGS84 already there, an unknown datum, WGS84, no WKT at all.
    const shifted = 'GEOGCS["x",DATUM["D_Monte_Mario",SPHEROID["a",1,2],TOWGS84[1,2,3]]]';
    assert.equal(withWktDatumShift(shifted), shifted);
    const unknown = 'GEOGCS["x",DATUM["D_Unknown",SPHEROID["a",1,2]]]';
    assert.equal(withWktDatumShift(unknown), unknown);
    const wgs84 =
      'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]';
    assert.equal(withWktDatumShift(wgs84), wgs84);
    assert.equal(withWktDatumShift("not wkt"), "not wkt");
  });

  it("matches every listed datum name, with or without ESRI's D_ prefix, in any case", () => {
    // Each name's first Helmert parameter, to tell its shift from the others'.
    const names: [string, string][] = [
      ["OSGB_1936", "446.448"],
      ["Ordnance_Survey_of_Great_Britain_1936", "446.448"],
      ["TM65", "482.5"],
      ["Deutsches_Hauptdreiecksnetz", "598.1"],
      ["Amersfoort", "565.417"],
      ["CH1903", "674.4"],
      ["CH1903+", "674.374"],
      ["Belge_1972", "-106.8686"],
      ["Reseau_National_Belge_1972", "-106.8686"],
      ["S_JTSK", "589"],
      ["System_of_the_Unified_Trigonometrical_Cadastral_Network", "589"],
      ["Monte_Mario", "-104.1"],
      ["Hungarian_1972", "52.17"],
      ["Hungarian_Datum_1972", "52.17"],
      ["GGRS_1987", "-199.87"],
      ["Greek_Geodetic_Reference_System_1987", "-199.87"],
      ["Hong_Kong_1980", "-162.619"],
    ];
    for (const [name, dx] of names) {
      for (const datum of [`D_${name}`, name.toLowerCase()]) {
        const wkt = `GEOGCS["x",DATUM["${datum}",SPHEROID["a",1,2]]]`;
        assert.ok(withWktDatumShift(wkt).includes(`TOWGS84[${dx},`), datum);
      }
    }
  });

  it("replaces EPSG:31300's definition, which the tables get wrong", () => {
    // EPSG Guidance Note 7-2, §1.3.1.4 (Lambert Conic Conformal 2SP Belgium):
    // this BD72 point is E 251763.20, N 153034.13 in EPSG:31300.
    const bd72 = `+proj=longlat +ellps=intl +towgs84=${datumShiftFor(4313)} +no_defs`;
    const lonLat = [5 + 48 / 60 + 26.533 / 3600, 50 + 40 / 60 + 46.461 / 3600];
    const grid = (code: number) =>
      (toProj4({ ProjectedCSTypeGeoKey: code } as never).proj4 ?? "").replace(/\+axis=\w+\s*/g, "");
    const off = (definition: string) => {
      const [e, n] = proj4(bd72, definition, lonLat);
      return Math.hypot(e - 251763.2, n - 153034.13);
    };
    // The tables give a plain LCC 2SP, without the method's 29.2985" rotation.
    assert.ok(off(grid(31300)) > 700);
    const fixed = withDatumShift(grid(31300), 31300);
    assert.ok(off(fixed) < 0.1);
    // The same grid, and the same datum shift, as EPSG:31370.
    assert.equal(fixed, withDatumShift(grid(31370).trim(), 31370));
  });

  it("leaves definitions that already shift, and codes it does not know", () => {
    assert.equal(withDatumShift("+proj=tmerc +towgs84=1,2,3", 27700), "+proj=tmerc +towgs84=1,2,3");
    assert.equal(
      withDatumShift("+proj=utm +zone=31 +datum=WGS84", 27700),
      "+proj=utm +zone=31 +datum=WGS84",
    );
    assert.equal(
      withDatumShift("+proj=utm +zone=31 +ellps=WGS84", 32631),
      "+proj=utm +zone=31 +ellps=WGS84",
    );
    assert.equal(datumShiftFor(32631), null);
    assert.equal(datumShiftFor(3857), null);
  });

  it("finds the code in GeoTIFF geokeys, or the datum of a user-defined CRS", () => {
    assert.match(withGeoKeysDatumShift("+proj=tmerc", { ProjectedCSTypeGeoKey: 27700 }), /towgs84/);
    assert.match(
      withGeoKeysDatumShift("+proj=longlat", { GeographicTypeGeoKey: 4314 }),
      /towgs84=598\.1/,
    );
    // User-defined projection (32767) on the Amersfoort datum (6289).
    assert.match(
      withGeoKeysDatumShift("+proj=sterea", {
        ProjectedCSTypeGeoKey: 32767,
        GeogGeodeticDatumGeoKey: 6289,
      }),
      /towgs84=565\.417/,
    );
    assert.equal(withGeoKeysDatumShift("+proj=tmerc", {}), "+proj=tmerc");
    assert.equal(withGeoKeysDatumShift("+proj=tmerc", null), "+proj=tmerc");
  });

  it("installs the cog-tiler hook, leaving WKT alone", () => {
    let hook: ((def: string, keys: Record<string, unknown>) => string | null | undefined) | null =
      null;
    installCogTilerDatumShift({ setSourceCrsResolver: (fn) => (hook = fn) });
    assert.ok(hook);
    const resolve = hook as (def: string, keys: Record<string, unknown>) => string;
    assert.match(resolve(bng(), { ProjectedCSTypeGeoKey: 27700 }), /towgs84/);
    const wkt = 'PROJCS["OSGB 1936 / British National Grid"]';
    assert.equal(resolve(wkt, { ProjectedCSTypeGeoKey: 27700 }), wkt);
    // An older tiler without the hook is left as it is.
    assert.doesNotThrow(() => installCogTilerDatumShift({}));
  });

  it("resolves datum-shifted codes offline for deck.gl COG layers, others through the fallback", async () => {
    const asked: number[] = [];
    const resolver = datumShiftEpsgResolver(async (epsg) => {
      asked.push(epsg);
      return { projName: "fallback" } as never;
    });
    const def = (await resolver(27700)) as unknown as Record<string, unknown>;
    assert.equal(def.units, "m");
    assert.deepEqual((def.datum_params as number[]).slice(0, 3), [446.448, -125.157, 542.06]);
    const lonLat = proj4(def as never, "EPSG:4326", [292100, 329590]);
    assert.ok(metres(lonLat, PROJ_LONLAT) < 2);
    assert.deepEqual(asked, []);
    assert.equal(((await resolver(32631)) as unknown as { projName: string }).projName, "fallback");
    assert.deepEqual(asked, [32631]);
    // Geographic codes resolve too (the tables take them as projected keys).
    const geographic = (await resolver(4314)) as unknown as Record<string, unknown>;
    assert.equal(geographic.projName, "longlat");
    assert.deepEqual((geographic.datum_params as number[]).slice(0, 3), [598.1, 73.7, 418.2]);
  });

  it("places polygonized objects through the raster's datum-shifted CRS", async () => {
    await initTools(
      readFileSync(new URL("../node_modules/geolibre-wasm/geolibre-cli.wasm", import.meta.url)),
    );
    // A 4 × 2 label raster on the British National Grid, 15 m pixels: object 1
    // on the left half, object 2 on the right.
    const labels = new Float32Array([1, 1, 2, 2, 1, 1, 2, 2]);
    const tiff = writeArrayBuffer(labels, {
      width: 4,
      height: 2,
      ModelPixelScale: [15, 15, 0],
      ModelTiepoint: [0, 0, 0, 292100, 329590, 0],
      ProjectedCSTypeGeoKey: 27700,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
    } as Parameters<typeof writeArrayBuffer>[1]) as ArrayBuffer;
    const objects = await polygonizeLabels(new Uint8Array(tiff));
    assert.equal(objects.features.length, 2);
    const ring = (id: number) => {
      const geometry = objects.features.find((f) => f.properties?.segment_id === id)?.geometry;
      return geometry?.type === "Polygon" ? geometry.coordinates[0] : [];
    };
    // Object 1's north-west corner is the raster's corner, where PROJ puts it.
    const west = Math.min(...ring(1).map((p) => p[0]));
    const north = Math.max(...ring(1).map((p) => p[1]));
    assert.ok(metres([west, north], PROJ_LONLAT) < 2, `corner ${west}, ${north}`);
    // Object 2 starts 30 m (2 pixels) east of it.
    const west2 = Math.min(...ring(2).map((p) => p[0]));
    assert.ok(Math.abs(metres([west2, north], [west, north]) - 30) < 0.5);
  });
});
