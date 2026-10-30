/// <reference lib="webworker" />
import { convertGeoTiffToCog, type ConvertGeoTiffToCogOptions } from "./cog-convert-engine";

export interface CogConvertRequest {
  bytes: Uint8Array;
  options: ConvertGeoTiffToCogOptions;
}

export type CogConvertResponse = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.addEventListener("message", async (event: MessageEvent<CogConvertRequest>) => {
  try {
    const bytes = await convertGeoTiffToCog(event.data.bytes, event.data.options);
    worker.postMessage({ ok: true, bytes } satisfies CogConvertResponse, [
      bytes.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    worker.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CogConvertResponse);
  }
});
