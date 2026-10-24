import { fireEvent, render, screen, useAppStore } from "./helpers/dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { createPortal } from "react-dom";
import type { MapEngine } from "@geolibre/map";

const { StoryMapPresentationTools, createPresentationToolsSession } =
  await import("../apps/geolibre-desktop/src/components/storymap/StoryMapPresentationTools");

/** Engine-neutral harness: no MapLibre instance and no business layer writes. */
function fakeEngine() {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  container.append(canvas);
  const flights: unknown[] = [];
  const engine = {
    getRenderSurface: () => ({
      getContainer: () => container,
      getCanvas: () => canvas,
      project: ([lng, lat]: [number, number]) => ({ x: lng, y: lat }),
      unproject: ([lng, lat]: [number, number]) => ({ lng, lat }),
    }),
    onCameraMove: () => () => {},
    onCameraIdle: () => () => {},
    readView: () => ({ zoom: 8 }),
    flyTo: (view: unknown) => flights.push(view),
  } as unknown as MapEngine;
  return {
    engine,
    flights,
    click: ([clientX, clientY]: [number, number]) => {
      const surface = screen.getByTestId("storymap-drawing-surface");
      fireEvent.pointerDown(surface, {
        clientX,
        clientY,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerUp(surface, {
        clientX,
        clientY,
        button: 0,
        pointerId: 1,
      });
    },
  };
}

describe("storymap presentation tools", () => {
  it("retains saved chapters across navigation and portal remounts until annotations change", () => {
    const fake = fakeEngine();
    const session = createPresentationToolsSession();
    const props = { engine: fake.engine, session, onInteract: () => {} };
    const view = render(createElement(StoryMapPresentationTools, { ...props, chapterId: "a" }));
    const initialLayers = useAppStore.getState().layers.length;
    const save = () =>
      screen.getByRole("button", { name: "Save as result layer" }) as HTMLButtonElement;
    const place = (coordinate: [number, number]) => {
      fireEvent.click(screen.getByRole("button", { name: "Place a marker" }));
      fake.click(coordinate);
    };
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    place([117, 39]);
    fireEvent.click(save());
    assert.equal(save().disabled, true);
    view.rerender(createElement(StoryMapPresentationTools, { ...props, chapterId: "b" }));
    place([118, 40]);
    fireEvent.click(save());
    view.rerender(createElement(StoryMapPresentationTools, { ...props, chapterId: "a" }));
    assert.equal(save().disabled, true);
    fireEvent.click(save());
    assert.equal(useAppStore.getState().layers.length, initialLayers + 2);
    view.unmount();
    const remounted = render(
      createElement(StoryMapPresentationTools, { ...props, chapterId: "a" }),
    );
    assert.equal(save().disabled, true);
    place([119, 41]);
    assert.equal(save().disabled, false);
    fireEvent.click(save());
    assert.equal(save().disabled, true);
    fireEvent.click(screen.getByRole("button", { name: "Remove last annotation" }));
    assert.equal(save().disabled, false);
    fireEvent.click(save());
    assert.equal(useAppStore.getState().layers.length, initialLayers + 4);
    remounted.rerender(createElement(StoryMapPresentationTools, { ...props, chapterId: "b" }));
    assert.equal(save().disabled, true);
  });

  it("restores completed annotations and the unfinished draft after a renderer portal is replaced", () => {
    const first = fakeEngine();
    const second = fakeEngine();
    const session = createPresentationToolsSession();
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    document.body.append(firstHost, secondHost);
    const draftStates: boolean[] = [];
    const element = (engine: MapEngine, host: HTMLElement) =>
      createPortal(
        createElement(StoryMapPresentationTools, {
          engine,
          chapterId: "a",
          session,
          onInteract: () => {},
          onDraftChange: (value) => draftStates.push(value),
        }),
        host,
      );
    const view = render(element(first.engine, firstHost));
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Place a marker" }));
    first.click([117, 39]);
    fireEvent.click(screen.getByRole("button", { name: "Draw a line" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Annotation text (optional)" }), {
      target: { value: "Unfinished route" },
    });
    first.click([117, 39]);
    assert.equal(session.annotations.a.length, 1);
    assert.equal(session.draft.length, 1);
    view.rerender(element(second.engine, secondHost));
    assert.equal(firstHost.childElementCount, 0);
    assert.equal(draftStates.at(-1), true);
    assert.equal(
      (
        screen.getByRole("textbox", {
          name: "Annotation text (optional)",
        }) as HTMLInputElement
      ).value,
      "Unfinished route",
    );
    assert.equal(
      (screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled,
      true,
    );
    assert.equal(screen.getByTestId("storymap-annotations").querySelectorAll("circle").length, 2);
    second.click([118, 39]);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    assert.equal(draftStates.at(-1), false);
    assert.equal(session.annotations.a.length, 2);
    assert.notEqual(session.annotations.a[0].id, session.annotations.a[1].id);
    assert.equal(session.annotations.a[1].properties.label, "Unfinished route");
    assert.equal(session.tool, null);
    assert.deepEqual(session.draft, []);
    view.unmount();
    firstHost.remove();
    secondHost.remove();
  });

  it("keeps temporary annotations per chapter and only writes a layer on explicit save", () => {
    const fake = fakeEngine();
    const draftStates: boolean[] = [];
    const props = {
      engine: fake.engine,
      onInteract: () => {},
      onDraftChange: (value: boolean) => draftStates.push(value),
    };
    const view = render(createElement(StoryMapPresentationTools, { ...props, chapterId: "a" }));
    const initialLayers = useAppStore.getState().layers.length;
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Place a marker" }));
    assert.equal(draftStates.at(-1), true);
    fake.click([117, 39]);
    assert.equal(draftStates.at(-1), false);
    assert.equal(screen.getByTestId("storymap-annotations").querySelectorAll("circle").length, 1);
    assert.equal(useAppStore.getState().layers.length, initialLayers);
    view.rerender(createElement(StoryMapPresentationTools, { ...props, chapterId: "b" }));
    assert.equal(screen.getByTestId("storymap-annotations").querySelectorAll("circle").length, 0);
    view.rerender(createElement(StoryMapPresentationTools, { ...props, chapterId: "a" }));
    assert.equal(screen.getByTestId("storymap-annotations").querySelectorAll("circle").length, 1);
    fireEvent.click(screen.getByRole("button", { name: "Save as result layer" }));
    assert.equal(useAppStore.getState().layers.length, initialLayers + 1);
  });

  it("keeps a distance drawing armed until finish/cancel and releases the drawing surface", () => {
    const fake = fakeEngine();
    const drafts: boolean[] = [];
    const view = render(
      createElement(StoryMapPresentationTools, {
        engine: fake.engine,
        chapterId: "a",
        onInteract: () => {},
        onDraftChange: (value) => drafts.push(value),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure distance" }));
    fake.click([0, 0]);
    assert.equal(
      (screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled,
      true,
    );
    fake.click([1, 0]);
    assert.match(screen.getByTestId("storymap-annotations").textContent ?? "", /111\.\d+ km/);
    assert.equal(drafts.at(-1), true);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    assert.equal(drafts.at(-1), false);
    assert.equal(screen.queryByTestId("storymap-drawing-surface"), null);
    fireEvent.click(screen.getByRole("button", { name: "Draw a line" }));
    fake.click([117, 39]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel drawing" }));
    assert.equal(drafts.at(-1), false);
    assert.equal(screen.getByTestId("storymap-annotations").querySelectorAll("polyline").length, 1);
    view.unmount();
    assert.equal(screen.queryByTestId("storymap-drawing-surface"), null);
  });

  it("pauses before coordinate navigation and never needs a geocoding request", () => {
    const fake = fakeEngine();
    let paused = false;
    const fly = fake.engine.flyTo;
    fake.engine.flyTo = (view) => {
      assert.equal(paused, true);
      fly(view);
    };
    render(
      createElement(StoryMapPresentationTools, {
        engine: fake.engine,
        chapterId: "a",
        onInteract: () => {
          paused = true;
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Search a place or latitude, longitude",
      }),
      { target: { value: "39.384, 117.044" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Locate" }));
    assert.deepEqual(fake.flights, [{ center: [117.044, 39.384], zoom: 13 }]);
  });
});
