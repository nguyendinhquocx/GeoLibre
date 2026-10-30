import { act, cleanup, i18n, render, waitFor } from "./helpers/dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createElement } from "react";
import { useTranslation } from "react-i18next";
import {
  addedRasters,
  conversions,
  rasterHandler,
  resetCogHarness,
} from "./helpers/cog-conversion-harness";

const { useRasterFileHandlers } =
  await import("../apps/geolibre-desktop/src/hooks/desktop-shell/useRasterFileHandlers");
const { clearNotifications, useNotificationStore } =
  await import("../apps/geolibre-desktop/src/lib/notify");

const mapControllerRef = { current: null };
const originalConfirm = window.confirm;
beforeEach(() => {
  window.confirm = () => true;
});
function RasterHost() {
  const { t } = useTranslation();
  useRasterFileHandlers(mapControllerRef, t);
  return null;
}

async function startConversion() {
  assert.ok(rasterHandler);
  const dismiss = mock.fn();
  const run = rasterHandler({
    layerId: "striped",
    name: "striped.tif",
    bytesAreRemote: false,
    readBytes: async () => Uint8Array.of(0x49, 0x49, 42, 0),
    dismiss,
  });
  await waitFor(() => assert.equal(conversions.length, 1));
  return { run, dismiss };
}

afterEach(async () => {
  cleanup();
  clearNotifications();
  resetCogHarness();
  mock.restoreAll();
  window.confirm = originalConfirm;
  await act(() => i18n.changeLanguage("en"));
});

describe("COG convert-and-load lifecycle", () => {
  it("keeps converting when the UI language changes", async () => {
    render(createElement(RasterHost));
    const { run, dismiss } = await startConversion();
    assert.equal(conversions[0].options.transferInput, true);

    await act(() => i18n.changeLanguage("zh"));
    assert.equal(conversions[0].options.signal?.aborted, false);
    assert.equal(useNotificationStore.getState().notifications.length, 1);

    conversions[0].result.resolve(Uint8Array.of(1));
    await run;
    assert.equal(addedRasters, 1);
    assert.equal(dismiss.mock.callCount(), 1);
    assert.equal(useNotificationStore.getState().notifications.length, 0);
  });

  it("aborts on unmount without replacing the source raster", async () => {
    const host = render(createElement(RasterHost));
    const { run, dismiss } = await startConversion();

    host.unmount();
    await run;
    assert.equal(conversions[0].options.signal?.aborted, true);
    assert.equal(addedRasters, 0);
    assert.equal(dismiss.mock.callCount(), 0);
    assert.equal(useNotificationStore.getState().notifications.length, 0);
    assert.equal(rasterHandler, null);
  });

  it("cancels from the notification and preserves the original layer", async () => {
    render(createElement(RasterHost));
    const { run, dismiss } = await startConversion();

    useNotificationStore.getState().notifications[0].action?.onClick();
    await run;
    assert.equal(conversions[0].options.signal?.aborted, true);
    assert.equal(addedRasters, 0);
    assert.equal(dismiss.mock.callCount(), 0);
    assert.equal(useNotificationStore.getState().notifications.length, 0);
  });
});
