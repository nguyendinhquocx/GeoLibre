// Maps the app's own surfaces onto the deployment capability vocabulary
// (`@geolibre/core`'s `DeploymentCapability`, issue #1673).
//
// The vocabulary is deliberately coarse, so each surface needs a table saying
// which of its ids fall under which capability. Keeping those tables in one
// module is the point: the toolbar menus, the Project menu, the command
// palette, the cheat sheet, and the global shortcut layer all reach the same
// handlers, and a gate applied to only some of them is not a gate.
//
// This is not the interface profile (`ui-profile.ts`), which hides items to
// reduce clutter and which the user can turn back on. A denied capability is a
// statement by whoever stood the deployment up.

import type { DeploymentCapability } from "@geolibre/core";
import type { Command } from "./commands";

/**
 * The capability each command family needs, keyed by command-id prefix.
 *
 * Ordered: the first matching prefix wins, so a specific id can be listed ahead
 * of the family prefix it belongs to.
 */
const COMMAND_CAPABILITY_PREFIXES: ReadonlyArray<readonly [string, DeploymentCapability]> = [
  // A review comment is stored in the project file, so it is project authoring
  // rather than adding data, despite sitting in the Add Data group.
  ["add.comment", "project:edit"],
  ["add.", "data:add"],
  ["proc.", "processing:run"],
  // The print layout designer exists to get a rendering back out, and sharing
  // puts the project itself on a server outside the deployment. Both are
  // classified the same way in PROJECT_MENU_ITEM_CAPABILITIES below; the two
  // tables disagreeing is what leaves an action hidden in the menu but live in
  // the palette.
  ["project.print-layout", "export:data"],
  ["project.share", "export:data"],
  // Includes opening a different project: a deployment that pins what may be
  // authored also pins which project is on screen.
  ["project.", "project:edit"],
  // Activating a plugin and opening the marketplace both belong to the plugin
  // gate, not the settings one: the toolbar hides the whole Plugins menu on
  // `plugins:install`, and "Manage plugins" is the marketplace despite its
  // `settings.` id.
  ["plugin.", "plugins:install"],
  ["settings.manage-plugins", "plugins:install"],
  ["settings.", "settings:manage"],
  // `control.`, `view.`, and `help.` are unprivileged: they move the camera,
  // toggle map decorations, and open documentation. A locked-down deployment
  // still wants all of them.
];

/**
 * The capability a command requires, or undefined when it requires none.
 *
 * @param id - The command id, e.g. `"proc.whitebox"`.
 * @returns The required capability, or undefined for unprivileged commands.
 */
export function commandCapability(id: string): DeploymentCapability | undefined {
  for (const [prefix, capability] of COMMAND_CAPABILITY_PREFIXES) {
    if (id.startsWith(prefix)) return capability;
  }
  return undefined;
}

/**
 * Drop commands this deployment is not allowed to run.
 *
 * The capability checks on the toolbar menus only hide menus. The command
 * palette, the cheat sheet, and the global shortcut layer reach the same
 * `run()` handlers without going through a menu, so they have to be filtered
 * too — an unfiltered palette leaves a denied action both advertised and
 * callable.
 *
 * @param commands - The full command registry.
 * @param capabilities - What this deployment may do.
 * @returns The commands whose required capability is granted.
 */
export function filterCommandsByCapabilities(
  commands: Command[],
  capabilities: ReadonlySet<DeploymentCapability>,
): Command[] {
  return commands.filter((command) => {
    const required = commandCapability(command.id);
    return !required || capabilities.has(required);
  });
}

/**
 * The capability each Project-menu item needs, keyed by its `ui-profile.ts`
 * menu-item catalog id.
 *
 * Spelled out per id rather than by prefix, because the Project menu mixes
 * authoring, export, and navigation under one `project.` namespace. An id
 * absent from this table is unprivileged.
 */
const PROJECT_MENU_ITEM_CAPABILITIES: Readonly<Record<string, DeploymentCapability>> = {
  "project.new": "project:edit",
  // Opening (from a file, from the recent list, from a QGIS/ArcGIS import) puts
  // a different project on screen, which is exactly what a pinned deployment
  // does not want; it is also the path by which the app reads arbitrary files.
  "project.openFrom": "project:edit",
  "project.openRecent": "project:edit",
  "project.import": "project:edit",
  "project.history": "project:edit",
  "project.save": "project:edit",
  "project.saveAs": "project:edit",
  "project.duplicate": "project:edit",
  "project.saveAsTemplate": "project:edit",
  "project.collaborate": "project:edit",
  "project.storymap": "project:edit",
  // Everything that gets data or a rendering back out of the deployment.
  "project.share": "export:data",
  "project.exportHtml": "export:data",
  "project.print": "export:data",
  "project.printLayout": "export:data",
  "project.offlineRegion": "export:data",
};

/**
 * The capability each Edit-menu item needs, keyed by its `ui-profile.ts`
 * menu-item catalog id.
 *
 * Only the items that change the project are listed. The selection tools
 * (select by expression/location, invert, clear, zoom to selection) act on
 * `selectedFeatureIds`, which is ephemeral store state that never reaches the
 * project file — a kiosk still wants them.
 */
const EDIT_MENU_ITEM_CAPABILITIES: Readonly<Record<string, DeploymentCapability>> = {
  "edit.undo": "project:edit",
  "edit.redo": "project:edit",
  // "Export Selection" names an export but adds a layer built from features
  // already loaded — no file, URL, or service — so by the vocabulary's own
  // definitions this is authoring the project, not `data:add` or `export:data`.
  "edit.exportSelection": "project:edit",
};

/**
 * The capability an Edit-menu item requires, or undefined when it requires
 * none.
 *
 * @param id - The menu-item catalog id, e.g. `"edit.undo"`.
 * @returns The required capability, or undefined for unprivileged items.
 */
export function editMenuItemCapability(id: string): DeploymentCapability | undefined {
  return EDIT_MENU_ITEM_CAPABILITIES[id];
}

/**
 * The capability a Project-menu item requires, or undefined when it requires
 * none.
 *
 * @param id - The menu-item catalog id, e.g. `"project.saveAs"`.
 * @returns The required capability, or undefined for unprivileged items.
 */
export function projectMenuItemCapability(id: string): DeploymentCapability | undefined {
  return PROJECT_MENU_ITEM_CAPABILITIES[id];
}
