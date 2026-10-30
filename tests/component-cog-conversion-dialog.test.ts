import { act, cleanup, fireEvent, render, screen, useAppStore, waitFor } from "./helpers/dom";
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createElement } from "react";
import { conversions, resetCogHarness, saves } from "./helpers/cog-conversion-harness";

const { ConversionDialog } =
  await import("../apps/geolibre-desktop/src/components/processing/ConversionDialog");

afterEach(() => {
  cleanup();
  mock.restoreAll();
  resetCogHarness();
});

async function startConversion() {
  mock.method(HTMLInputElement.prototype, "click", function (this: HTMLInputElement) {
    Object.defineProperty(this, "files", {
      value: [{ name: "input.tif", arrayBuffer: async () => new ArrayBuffer(4) }],
    });
    this.dispatchEvent(new Event("change"));
  });
  render(createElement(ConversionDialog));
  act(() => useAppStore.getState().setConversionOpen("raster-to-cog"));
  fireEvent.click(screen.getByTitle("Choose input file"));
  fireEvent.click(screen.getByRole("button", { name: "Convert" }));
  await waitFor(() => assert.equal(conversions.length, 1));
}

describe("COG conversion dialog lifecycle", () => {
  it("does not publish a cancelled run into a newly opened tool", async () => {
    await startConversion();
    act(() => useAppStore.getState().setConversionOpen("vector-to-geoparquet"));
    await waitFor(() => assert.equal(conversions[0].options.signal?.aborted, true));
    assert.equal(saves.length, 0);
    assert.equal(screen.queryByText("Conversion cancelled."), null);
  });

  it("records a completed save after switching tools without altering the new dialog", async () => {
    await startConversion();
    await act(async () => conversions[0].result.resolve(Uint8Array.of(1)));
    await waitFor(() => assert.equal(saves.length, 1));
    act(() => useAppStore.getState().setConversionOpen("vector-to-geoparquet"));
    await act(async () => saves[0].resolve("output.tif"));
    await waitFor(() => assert.equal(useAppStore.getState().processingHistory.length, 1));
    assert.equal(useAppStore.getState().processingHistory[0].status, "success");
    assert.equal(screen.queryByText(/Saved output.tif/), null);
  });

  it("records a save failure after switching tools", async () => {
    await startConversion();
    await act(async () => conversions[0].result.resolve(Uint8Array.of(1)));
    await waitFor(() => assert.equal(saves.length, 1));
    act(() => useAppStore.getState().setConversionOpen("vector-to-geoparquet"));
    await act(async () => saves[0].reject(new Error("disk full")));
    await waitFor(() => assert.equal(useAppStore.getState().processingHistory.length, 1));
    assert.equal(useAppStore.getState().processingHistory[0].status, "error");
    assert.equal(useAppStore.getState().processingHistory[0].error, "disk full");
    assert.equal(screen.queryByText("disk full"), null);
  });
});
