import { useAppStore } from "@geolibre/core";
import { MapboxCanvas, type MapEngine } from "@geolibre/map";
import type { ComponentType, ReactElement, RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useMapboxAccessToken } from "../../hooks/useMapboxAccessToken";
import { openSettingsSection } from "./SettingsDialog";

// `Trans` is typed against the catalog's key union; the cast keeps the rich
// hint text (a button that deep-links into Settings) type-checkable here the
// same way SettingsDialog's own `SettingsTrans` does.
const HintTrans = Trans as ComponentType<{
  i18nKey: string;
  components: Record<string, ReactElement>;
}>;

/** Shared by the primary workspace and split panes, including the token hint. */
export function PrimaryMapboxCanvas({
  engineRef,
  onEngineReady,
  viewId,
}: {
  engineRef?: RefObject<MapEngine | null>;
  onEngineReady?: () => void;
  viewId?: string;
}) {
  const { t } = useTranslation();
  const token = useMapboxAccessToken();
  const basemap = useAppStore((s) => s.preferences.map.mapboxStyleUrl ?? "");
  const setBasemap = (url: string) => {
    const state = useAppStore.getState();
    state.setPreferences({
      ...state.preferences,
      map: { ...state.preferences.map, mapboxStyleUrl: url || undefined },
    });
  };
  const styles = [
    ["", t("renderer.projectBasemap")],
    ["mapbox://styles/mapbox/standard", "Mapbox Standard"],
    ["mapbox://styles/mapbox/streets-v12", "Mapbox Streets"],
    ["mapbox://styles/mapbox/outdoors-v12", "Mapbox Outdoors"],
    ["mapbox://styles/mapbox/satellite-v9", "Mapbox Satellite"],
    ["mapbox://styles/mapbox/satellite-streets-v12", "Mapbox Satellite Streets"],
    ["mapbox://styles/mapbox/light-v11", "Mapbox Light"],
    ["mapbox://styles/mapbox/dark-v11", "Mapbox Dark"],
  ];
  return (
    <div className="absolute inset-0" data-testid="primary-mapbox">
      {token ? (
        <MapboxCanvas
          accessToken={token}
          engineRef={engineRef}
          onEngineReady={onEngineReady}
          viewId={viewId}
        />
      ) : (
        <div
          role="status"
          className="flex h-full items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground"
        >
          {/* The Settings part of the hint opens the Environment section with
              the Mapbox token field focused, so first-time setup is one click.
              One block child: as direct flex items the text fragments around
              the inline button would lose their surrounding spaces. */}
          <p className="max-w-md">
            <HintTrans
              i18nKey="renderer.mapboxTokenHint"
              components={{
                settingsLink: (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => openSettingsSection("environment", { focus: "mapboxToken" })}
                  />
                ),
              }}
            />
          </p>
        </div>
      )}
      {token && (
        <select
          aria-label={t("renderer.basemap")}
          value={basemap}
          onChange={(event) => setBasemap(event.target.value)}
          className="absolute top-12 start-2 z-10 max-w-[45%] rounded border border-input bg-background px-2 py-1 text-xs text-foreground shadow"
        >
          {!styles.some(([url]) => url === basemap) && (
            <option value={basemap}>{t("renderer.projectBasemap")}</option>
          )}
          {styles.map(([url, label]) => (
            <option key={url} value={url}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
