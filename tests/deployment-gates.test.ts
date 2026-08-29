import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Command } from "../apps/geolibre-desktop/src/lib/commands";
import {
  commandCapability,
  editMenuItemCapability,
  filterCommandsByCapabilities,
  projectMenuItemCapability,
} from "../apps/geolibre-desktop/src/lib/deployment-gates";
import {
  ALL_DEPLOYMENT_CAPABILITIES,
  type DeploymentCapability,
} from "../packages/core/src/deployment-capabilities";

function command(id: string): Command {
  return { id, title: id, group: "Group", run: () => {} };
}

describe("commandCapability", () => {
  it("maps each command family to the capability it needs", () => {
    assert.equal(commandCapability("add.vector"), "data:add");
    assert.equal(commandCapability("proc.whitebox"), "processing:run");
    assert.equal(commandCapability("proc.conversion.pmtiles"), "processing:run");
    assert.equal(commandCapability("project.save"), "project:edit");
    assert.equal(commandCapability("project.open-url"), "project:edit");
    assert.equal(commandCapability("settings.style-manager"), "settings:manage");
  });

  it("puts plugin activation and the marketplace under plugins:install", () => {
    assert.equal(commandCapability("plugin.reverse-geocode"), "plugins:install");
    // Despite its `settings.` id, "Manage plugins" opens the marketplace.
    assert.equal(commandCapability("settings.manage-plugins"), "plugins:install");
  });

  it("treats the print layout and Share as exports, not project authoring", () => {
    assert.equal(commandCapability("project.print-layout"), "export:data");
    assert.equal(commandCapability("project.share"), "export:data");
  });

  it("classifies a command the same way the Project menu classifies it", () => {
    // The two tables key off different ids for the same action, so they can
    // silently disagree; a mismatch hides an item in the menu while leaving it
    // live in the palette.
    for (const [commandId, menuItemId] of [
      ["project.new", "project.new"],
      ["project.save", "project.save"],
      ["project.save-as", "project.saveAs"],
      ["project.open-file", "project.openFrom"],
      ["project.open-url", "project.openFrom"],
      ["project.share", "project.share"],
      ["project.collaborate", "project.collaborate"],
      ["project.print-layout", "project.printLayout"],
    ] as const) {
      assert.equal(
        commandCapability(commandId),
        projectMenuItemCapability(menuItemId),
        `${commandId} vs ${menuItemId}`,
      );
    }
  });

  it("treats a review comment as project authoring, not adding data", () => {
    assert.equal(commandCapability("add.comment"), "project:edit");
  });

  it("leaves camera, decoration, and help commands unprivileged", () => {
    assert.equal(commandCapability("view.zoom-in"), undefined);
    assert.equal(commandCapability("control.legend"), undefined);
    assert.equal(commandCapability("help.about"), undefined);
  });
});

describe("filterCommandsByCapabilities", () => {
  const registry = [
    "project.save",
    "add.vector",
    "proc.whitebox",
    "settings.style-manager",
    "view.zoom-in",
  ].map(command);

  it("keeps every command when the deployment grants everything", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, ALL_DEPLOYMENT_CAPABILITIES).map((c) => c.id),
      registry.map((c) => c.id),
    );
  });

  it("drops the commands whose capability was withheld", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, new Set<DeploymentCapability>()).map((c) => c.id),
      ["view.zoom-in"],
    );
  });

  it("keeps a granted family while dropping a denied one", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, new Set<DeploymentCapability>(["data:add"])).map(
        (c) => c.id,
      ),
      ["add.vector", "view.zoom-in"],
    );
  });
});

describe("projectMenuItemCapability", () => {
  it("gates the authoring items on project:edit", () => {
    for (const id of [
      "project.new",
      "project.openFrom",
      "project.openRecent",
      "project.import",
      "project.history",
      "project.save",
      "project.saveAs",
      "project.duplicate",
      "project.saveAsTemplate",
      "project.collaborate",
      "project.storymap",
    ]) {
      assert.equal(projectMenuItemCapability(id), "project:edit", id);
    }
  });

  it("gates the items that get data back out on export:data", () => {
    for (const id of [
      "project.share",
      "project.exportHtml",
      "project.print",
      "project.printLayout",
      "project.offlineRegion",
    ]) {
      assert.equal(projectMenuItemCapability(id), "export:data", id);
    }
  });

  it("returns undefined for an id it does not gate", () => {
    assert.equal(projectMenuItemCapability("project.unknown"), undefined);
  });
});

describe("editMenuItemCapability", () => {
  it("gates the items that change the project on project:edit", () => {
    assert.equal(editMenuItemCapability("edit.undo"), "project:edit");
    assert.equal(editMenuItemCapability("edit.redo"), "project:edit");
    assert.equal(editMenuItemCapability("edit.exportSelection"), "project:edit");
  });

  it("leaves the selection tools unprivileged", () => {
    // Selection lives in ephemeral store state, never in the project file.
    for (const id of [
      "edit.selectByExpression",
      "edit.selectByLocation",
      "edit.zoomToSelection",
      "edit.invertSelection",
      "edit.clearSelection",
    ]) {
      assert.equal(editMenuItemCapability(id), undefined, id);
    }
  });
});
