import { useAppStore } from "@geolibre/core";
import type { GeoLibrePointCloudLayerOptions } from "@geolibre/plugins";
import type { addLidarLayerFromBytes, addLidarLayerFromUrl } from "@geolibre/plugins/lidar";

const METHOD = "addPointCloudLayer";
/** The extensions the LiDAR control's file loader reads (LAS, LAZ, COPC). */
const POINT_CLOUD_FILE_NAME = /\.la[sz]$/i;

/** The LiDAR helpers the plugin method delegates to, injected so tests can fake them. */
export interface PointCloudLayerHost {
  addLidarLayerFromUrl: typeof addLidarLayerFromUrl;
  addLidarLayerFromBytes: typeof addLidarLayerFromBytes;
}

type AppForLidar = Parameters<typeof addLidarLayerFromUrl>[0];

/**
 * The point cloud half of the external plugin API: add a LAS/LAZ/COPC file or
 * an EPT dataset as a GeoLibre LiDAR layer through the same LiDAR control the
 * Add Data dialog, the `?data=` deep link and file drops use, so the layer is
 * listed, styled, saved and restored like one the user added.
 *
 * @param app - The host API object, which the LiDAR helpers take.
 * @param host - The LiDAR helpers from `@geolibre/plugins/lidar`.
 * @param source - A URL, a `File`, or the file's bytes.
 * @param options - Layer name, loader file name, and whether to fly to the cloud.
 * @returns The new layer's id.
 * @throws When the source or options are invalid, or the point cloud cannot be loaded.
 */
export async function addPluginPointCloudLayer(
  app: AppForLidar,
  host: PointCloudLayerHost,
  source: string | File | ArrayBuffer | Uint8Array,
  options: GeoLibrePointCloudLayerOptions = {},
): Promise<string> {
  const name = optionalString(options.name, "name");
  const fit = options.zoomTo ?? true;
  let layerId: string | null;
  if (typeof source === "string") {
    const url = source.trim();
    if (!url) throw new Error(`${METHOD}: the URL is empty.`);
    // Validates the scheme (HTTP(S) or s3://) and presigns private buckets.
    layerId = await host.addLidarLayerFromUrl(app, url, { fit });
    if (layerId && name) useAppStore.getState().updateLayer(layerId, { name });
  } else {
    const bytes = pointCloudBytes(source);
    const fileName =
      optionalString(options.fileName, "fileName") ?? (isFile(bytes) ? bytes.name : undefined);
    if (!fileName) {
      throw new Error(`${METHOD}: pass options.fileName for an in-memory point cloud.`);
    }
    if (!POINT_CLOUD_FILE_NAME.test(fileName)) {
      throw new Error(
        `${METHOD}: "${fileName}" is not a point cloud file name (.las, .laz or .copc.laz).`,
      );
    }
    layerId = await host.addLidarLayerFromBytes(app, bytes, {
      name: name ?? fileName,
      fileName,
      fit,
    });
  }
  if (!layerId) throw new Error(`${METHOD}: the LiDAR layer could not be opened.`);
  return layerId;
}

/**
 * Check an optional string option. External plugins call through a JS boundary
 * where TypeScript cannot enforce the type.
 *
 * @param value - The option value.
 * @param option - The option name, for the error message.
 * @returns The trimmed string, or undefined when absent or blank.
 */
function optionalString(value: unknown, option: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${METHOD}: options.${option} must be a string.`);
  return value.trim() || undefined;
}

/** Whether a value is a browser `File` (absent in some runtimes). */
function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

/**
 * Normalise a non-URL source to what the LiDAR helper takes: a `File` stays a
 * `File` (so a large COPC streams without a copy), bytes become a `Uint8Array`
 * view without copying.
 *
 * @param source - The plugin's source.
 * @returns The bytes to load.
 */
function pointCloudBytes(source: unknown): File | Uint8Array {
  if (isFile(source)) return source;
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  throw new Error(`${METHOD}: the source must be a URL, a File, an ArrayBuffer or a Uint8Array.`);
}
