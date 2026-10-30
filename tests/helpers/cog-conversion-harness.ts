import { registerHooks } from "node:module";
import type { NonTiledRasterRequest } from "../../packages/plugins/src/plugins/maplibre-raster";
import type { ConvertGeoTiffToCogOptions } from "../../packages/processing/src/cog-convert";

export const conversions: {
  bytes: Uint8Array;
  options: ConvertGeoTiffToCogOptions;
  result: PromiseWithResolvers<Uint8Array>;
}[] = [];
export const saves: PromiseWithResolvers<string | null>[] = [];
export let rasterHandler: ((request: NonTiledRasterRequest) => Promise<void>) | null = null;
export let addedRasters = 0;

export function setNonTiledRasterHandler(handler: typeof rasterHandler) {
  rasterHandler = handler;
}

export function convertGeoTiffToCog(bytes: Uint8Array, options: ConvertGeoTiffToCogOptions = {}) {
  const result = Promise.withResolvers<Uint8Array>();
  conversions.push({ bytes, options, result });
  options.signal?.addEventListener("abort", () => result.reject(options.signal?.reason), {
    once: true,
  });
  return result.promise;
}

export async function readGeoTiffInfo() {
  return { ok: true, width: 32, height: 32, bands: 1, tiled: false };
}

export async function addRasterToMap() {
  addedRasters += 1;
}

export function saveBinaryFileWithFallback() {
  const result = Promise.withResolvers<string | null>();
  saves.push(result);
  return result.promise;
}

export function resetCogHarness() {
  conversions.length = 0;
  saves.length = 0;
  addedRasters = 0;
}

// Substitute only the I/O boundaries of the real hook and dialog. React effects,
// cancellation, history, notifications and stale-run handling stay production code.
const helperUrl = import.meta.url;
const processingUrl = new URL("../../packages/processing/src/index.ts", import.meta.url).href;
const tauriUrl = new URL("../../apps/geolibre-desktop/src/lib/tauri-io.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ?? "";
    if (!/\/(useRasterFileHandlers\.ts|ConversionDialog\.tsx)$/.test(parent)) {
      return nextResolve(specifier, context);
    }
    let source: string | undefined;
    if (specifier === "@geolibre/processing") {
      source = `export * from ${JSON.stringify(processingUrl)};
        export { convertGeoTiffToCog, readGeoTiffInfo } from ${JSON.stringify(helperUrl)};`;
    } else if (specifier === "@geolibre/plugins") {
      source = `export { setNonTiledRasterHandler, addRasterToMap } from ${JSON.stringify(helperUrl)};
        export const setLocalRasterFileReader = () => {};
        export const setLocalRasterPicker = () => {};
        export const setUnrestorableRasterHandler = () => {};`;
    } else if (specifier.endsWith("/usePlugins")) {
      source = "export const createAppAPI = () => ({});";
    } else if (specifier.endsWith("/tauri-io")) {
      source = `export * from ${JSON.stringify(tauriUrl)};
        export { saveBinaryFileWithFallback } from ${JSON.stringify(helperUrl)};`;
    }
    return source === undefined
      ? nextResolve(specifier, context)
      : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  },
});
