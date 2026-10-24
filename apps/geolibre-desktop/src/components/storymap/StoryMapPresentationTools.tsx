import {
  geocodeForward,
  resolveGeocoderConfig,
  useAppStore,
  type GeocodeMatch,
} from "@geolibre/core";
import type { MapEngine } from "@geolibre/map";
import { Button, Input, cn } from "@geolibre/ui";
import {
  Check,
  MapPin,
  Pencil,
  Pentagon,
  Ruler,
  Save,
  Search,
  Spline,
  SquareDashed,
  Type,
  Undo2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { parseLatLon } from "../../lib/coordinates";
import {
  createPresentationAnnotation,
  presentationAnnotationsCollection,
  presentationGeometry,
  presentationMeasurementLabel,
  type PresentationAnnotation,
  type PresentationCoordinate,
  type PresentationTool,
} from "../../lib/storymap-presentation-annotations";

interface StoryMapPresentationToolsProps {
  engine: MapEngine;
  chapterId: string;
  chapterTitle?: string;
  disabled?: boolean;
  /** Hand control to the presenter before any tool changes the map. */
  onInteract: () => void;
  /** An armed drawing tool must be completed or cancelled before navigation. */
  onDraftChange?: (drawing: boolean) => void;
  /** Stable for one presentation, including renderer/portal changes. */
  session?: PresentationToolsSession;
}

/** Session-only state owned above the map portal; it is never project data. */
export interface PresentationToolsSession {
  annotations: Record<string, PresentationAnnotation[]>;
  savedAnnotations: Record<string, PresentationAnnotation[]>;
  tool: PresentationTool | null;
  draft: PresentationCoordinate[];
  label: string;
  expanded: boolean;
  nextAnnotationId: number;
}

/** Create once on presentation entry; discard on exit, retain across engines. */
export function createPresentationToolsSession(): PresentationToolsSession {
  return {
    annotations: {},
    savedAnnotations: {},
    tool: null,
    draft: [],
    label: "",
    expanded: false,
    nextAnnotationId: 0,
  };
}

const TOOL_ITEMS = [
  { tool: "point", icon: MapPin },
  { tool: "text", icon: Type },
  { tool: "line", icon: Spline },
  { tool: "polygon", icon: Pentagon },
  { tool: "distance", icon: Ruler },
  { tool: "area", icon: SquareDashed },
] as const;

/**
 * Live presentation tools. Geometry lives only in the presentation's chapter cache,
 * never in project layers, until the presenter explicitly saves a result.
 * Mount once for the whole presentation (do not key the component by chapter).
 */
export function StoryMapPresentationTools({
  engine,
  chapterId,
  chapterTitle,
  disabled = false,
  onInteract,
  onDraftChange,
  session,
}: StoryMapPresentationToolsProps): ReactElement {
  const { t, i18n } = useTranslation();
  const geocoding = useAppStore((state) => state.preferences.geocoding);
  const ownedSessionRef = useRef<PresentationToolsSession | null>(null);
  if (!ownedSessionRef.current) ownedSessionRef.current = createPresentationToolsSession();
  const presentationSession = session ?? ownedSessionRef.current;
  const [expanded, setExpanded] = useState(
    () => presentationSession.expanded || presentationSession.tool !== null,
  );
  const [tool, setTool] = useState<PresentationTool | null>(() => presentationSession.tool);
  const [draft, setDraft] = useState<PresentationCoordinate[]>(() => presentationSession.draft);
  const [label, setLabel] = useState(() => presentationSession.label);
  const [annotations, setAnnotations] = useState<Record<string, PresentationAnnotation[]>>(
    () => presentationSession.annotations,
  );
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<GeocodeMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<"noMatches" | "searchError" | null>(null);
  const [searchLocation, setSearchLocation] = useState<{
    chapterId: string;
    coordinate: PresentationCoordinate;
  } | null>(null);
  const [savedAnnotations, setSavedAnnotations] = useState(
    () => presentationSession.savedAnnotations,
  );
  const [, invalidateProjection] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const draftCallbackRef = useRef(onDraftChange);
  draftCallbackRef.current = onDraftChange;
  const surface = engine.getRenderSurface();
  const chapterAnnotations = annotations[chapterId] ?? [];
  const saved = chapterAnnotations.length > 0 && savedAnnotations[chapterId] === chapterAnnotations;

  // Commit before paint so a portal remount starts from the latest user input.
  // The caller keeps this same session object until the presentation ends.
  useLayoutEffect(() => {
    Object.assign(presentationSession, {
      annotations,
      savedAnnotations,
      tool,
      draft,
      label,
      expanded,
    });
  }, [presentationSession, annotations, savedAnnotations, tool, draft, label, expanded]);

  // In-flight lookups must never move the camera after a chapter change/exit.
  useEffect(() => {
    setMatches([]);
    setSearchError(null);
    setSearching(false);
    return () => abortRef.current?.abort();
  }, [chapterId]);

  useEffect(() => {
    draftCallbackRef.current?.(tool !== null);
    return () => draftCallbackRef.current?.(false);
  }, [tool]);

  // Both the map's movement and container resizing change projected SVG points.
  useEffect(() => {
    const update = () => invalidateProjection((version) => version + 1);
    const stop = engine.onCameraMove(update);
    const idle = engine.onCameraIdle(update);
    const container = engine.getRenderSurface()?.getContainer();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (container) observer?.observe(container);
    return () => {
      stop();
      idle();
      observer?.disconnect();
    };
  }, [engine]);

  const cancelDrawing = useCallback(() => {
    setTool(null);
    setDraft([]);
    draftCallbackRef.current?.(false);
  }, []);

  const addAnnotation = useCallback((annotation: PresentationAnnotation) => {
    setAnnotations((current) => ({
      ...current,
      [annotation.properties.chapterId]: [
        ...(current[annotation.properties.chapterId] ?? []),
        annotation,
      ],
    }));
  }, []);

  const placeVertex = (coordinate: PresentationCoordinate) => {
    if (!tool || disabled) return;
    onInteract();
    if (tool === "point" || tool === "text") {
      if (tool === "text" && !label.trim()) return;
      const annotation = createPresentationAnnotation(
        tool,
        [coordinate],
        chapterId,
        label,
        `presentation-${++presentationSession.nextAnnotationId}`,
      );
      if (annotation) addAnnotation(annotation);
      cancelDrawing();
    } else {
      setDraft((current) => {
        const last = current[current.length - 1];
        return last?.[0] === coordinate[0] && last?.[1] === coordinate[1]
          ? current
          : [...current, coordinate];
      });
    }
  };

  const finishDrawing = () => {
    if (!tool) return;
    const annotation = createPresentationAnnotation(
      tool,
      draft,
      chapterId,
      label,
      `presentation-${++presentationSession.nextAnnotationId}`,
    );
    if (!annotation) return;
    addAnnotation(annotation);
    cancelDrawing();
  };

  const locate = (coordinate: PresentationCoordinate) => {
    abortRef.current?.abort();
    setSearching(false);
    setMatches([]);
    setSearchError(null);
    setSearchLocation({ chapterId, coordinate });
    onInteract();
    engine.flyTo({
      center: coordinate,
      zoom: Math.max(13, engine.readView().zoom),
    });
  };

  const search = async () => {
    const text = query.trim();
    if (!text || disabled || tool) return;
    onInteract();
    abortRef.current?.abort();
    const coordinates = parseLatLon(text);
    if (coordinates) {
      locate([coordinates.lon, coordinates.lat]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setMatches([]);
    setSearching(true);
    setSearchError(null);
    try {
      // Submit only: respect providers that disallow search-as-you-type.
      const found = await geocodeForward(text, {
        config: resolveGeocoderConfig(geocoding),
        signal: controller.signal,
        limit: 5,
      });
      if (controller.signal.aborted) return;
      if (found.length === 0) setSearchError("noMatches");
      else setMatches(found);
    } catch {
      if (!controller.signal.aborted) setSearchError("searchError");
    } finally {
      if (abortRef.current === controller) setSearching(false);
    }
  };

  const draftAnnotation =
    tool && draft.length > 0
      ? createPresentationAnnotation(tool, draft, chapterId, label, "draft")
      : null;
  const measurement = draftAnnotation
    ? presentationMeasurementLabel(draftAnnotation, i18n.language)
    : "";
  const measurementTool = tool === "distance" || tool === "area";

  const project = (coordinate: PresentationCoordinate) => {
    try {
      const point = surface?.project(coordinate);
      return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
    } catch {
      return null;
    }
  };

  const renderAnnotation = (annotation: PresentationAnnotation) => {
    const geometry = annotation.geometry;
    const coordinates =
      geometry.type === "Point"
        ? [geometry.coordinates]
        : geometry.type === "Polygon"
          ? geometry.coordinates[0]
          : geometry.coordinates;
    const projected = coordinates.map((coordinate) =>
      project(coordinate as PresentationCoordinate),
    );
    // A point behind a globe cannot be projected; do not connect through it.
    if (projected.some((point) => !point)) return null;
    const points = projected as { x: number; y: number }[];
    const anchor = points[geometry.type === "Polygon" ? 0 : points.length - 1];
    if (!anchor) return null;
    const measurementLabel = presentationMeasurementLabel(annotation, i18n.language);
    const caption = [annotation.properties.label, measurementLabel].filter(Boolean).join(" · ");
    return (
      <g key={annotation.id}>
        {geometry.type === "Point" ? (
          <circle cx={anchor.x} cy={anchor.y} r={6} fill="#ef4444" stroke="white" strokeWidth={2} />
        ) : (
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill={geometry.type === "Polygon" ? "#ef444426" : "none"}
            stroke="#ef4444"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}
        {caption && (
          <text
            x={anchor.x + 10}
            y={anchor.y - 10}
            fill="#b91c1c"
            stroke="white"
            strokeWidth={4}
            paintOrder="stroke"
            fontSize={14}
            fontWeight={600}
          >
            {caption}
          </text>
        )}
      </g>
    );
  };

  const projectedDraft = draft.map(project);
  const searchPoint =
    searchLocation?.chapterId === chapterId ? project(searchLocation.coordinate) : null;
  return (
    <>
      {/* Capture drawing gestures only while armed. Existing Identify and
          editor plugins must never receive temporary annotation clicks. */}
      {tool && !disabled && (
        <div
          className="pointer-events-auto absolute inset-0 z-[62] cursor-crosshair touch-none"
          data-testid="storymap-drawing-surface"
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.button !== 0) return;
            onInteract();
            pointerStartRef.current = {
              x: event.clientX,
              y: event.clientY,
              id: event.pointerId,
            };
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            const start = pointerStartRef.current;
            pointerStartRef.current = null;
            if (
              !start ||
              start.id !== event.pointerId ||
              Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5
            )
              return;
            const box = surface?.getCanvas().getBoundingClientRect();
            if (!box) return;
            const location = surface?.unproject([
              event.clientX - box.left,
              event.clientY - box.top,
            ]);
            if (location) placeVertex([location.lng, location.lat]);
          }}
          onPointerCancel={() => {
            pointerStartRef.current = null;
          }}
          onPointerLeave={() => {
            pointerStartRef.current = null;
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onWheel={(event) => event.stopPropagation()}
        />
      )}
      <svg
        className="pointer-events-none absolute inset-0 z-[63] h-full w-full overflow-hidden"
        aria-hidden="true"
        data-testid="storymap-annotations"
      >
        {!disabled && chapterAnnotations.map(renderAnnotation)}
        {!disabled && draftAnnotation && renderAnnotation(draftAnnotation)}
        {!disabled && tool && projectedDraft.every(Boolean) && (
          <g>
            {!draftAnnotation && (
              <polyline
                points={projectedDraft.map((point) => `${point!.x},${point!.y}`).join(" ")}
                fill="none"
                stroke="#ef4444"
                strokeWidth={3}
                strokeDasharray="5 4"
              />
            )}
            {projectedDraft.map(
              (point, index) =>
                point && (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={4}
                    fill="white"
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                ),
            )}
          </g>
        )}
        {!disabled && searchPoint && (
          <circle
            cx={searchPoint.x}
            cy={searchPoint.y}
            r={10}
            fill="#2563eb33"
            stroke="#2563eb"
            strokeWidth={3}
          />
        )}
      </svg>
      <div
        className="pointer-events-auto absolute end-14 top-3 z-[72] max-w-[calc(100%-5rem)]"
        data-story-tools
        data-testid="storymap-presentation-tools"
        onPointerDown={(event) => {
          event.stopPropagation();
          onInteract();
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <Button
          variant="secondary"
          className="ms-auto flex gap-2 bg-background/95 shadow-md"
          disabled={disabled || tool !== null}
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <Pencil className="h-4 w-4" />
          {t("storymap.presentationTools.title")}
        </Button>
        {expanded && !disabled && (
          <section
            aria-label={t("storymap.presentationTools.title")}
            className="mt-2 w-72 max-w-full space-y-2 rounded-lg border bg-background/95 p-3 text-foreground shadow-lg"
          >
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <Input
                className="h-8 min-w-0 text-xs"
                value={query}
                disabled={tool !== null}
                aria-label={t("storymap.presentationTools.searchPlaceholder")}
                placeholder={t("storymap.presentationTools.searchPlaceholder")}
                onFocus={onInteract}
                onChange={(event) => {
                  abortRef.current?.abort();
                  setSearching(false);
                  setMatches([]);
                  setSearchError(null);
                  setQuery(event.target.value);
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                variant="outline"
                disabled={searching || tool !== null || !query.trim()}
                aria-label={t("storymap.presentationTools.search")}
                title={t("storymap.presentationTools.search")}
              >
                <Search className="h-4 w-4" />
              </Button>
            </form>
            {searching && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("storymap.presentationTools.searching")}
              </p>
            )}
            {searchError && (
              <p role="alert" className="text-xs text-destructive">
                {t(`storymap.presentationTools.${searchError}`)}
              </p>
            )}
            {matches.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded border text-xs">
                {matches.map((match) => (
                  <li key={`${match.lon},${match.lat}:${match.displayName}`}>
                    <button
                      type="button"
                      className="w-full px-2 py-1.5 text-start hover:bg-muted"
                      onClick={() => locate([match.lon, match.lat])}
                    >
                      {match.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-3 gap-1">
              {TOOL_ITEMS.map(({ tool: item, icon: Icon }) => (
                <Button
                  key={item}
                  size="sm"
                  variant={tool === item ? "default" : "outline"}
                  className="gap-1 px-1 text-xs"
                  disabled={!surface || (tool !== null && tool !== item)}
                  aria-pressed={tool === item}
                  onClick={() => {
                    onInteract();
                    abortRef.current?.abort();
                    setMatches([]);
                    setSearching(false);
                    setTool(item);
                    draftCallbackRef.current?.(true);
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`storymap.presentationTools.${item}`)}
                </Button>
              ))}
            </div>
            {!surface && (
              <p className="text-xs text-muted-foreground">
                {t("storymap.presentationTools.unavailable")}
              </p>
            )}
            {tool && (
              <>
                <Input
                  value={label}
                  maxLength={160}
                  className="h-8 text-xs"
                  aria-label={t("storymap.presentationTools.label")}
                  placeholder={t("storymap.presentationTools.label")}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    tool === "text"
                      ? "storymap.presentationTools.textRequired"
                      : tool === "point"
                        ? "storymap.presentationTools.pointHint"
                        : "storymap.presentationTools.drawHint",
                  )}
                </p>
                {measurement && (
                  <p role="status" className="font-mono text-sm font-medium">
                    {measurement}
                  </p>
                )}
                {measurementTool && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("storymap.presentationTools.measurementHint")}
                  </p>
                )}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={!presentationGeometry(tool, draft)}
                    onClick={finishDrawing}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t("storymap.presentationTools.finish")}
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    disabled={!draft.length}
                    title={t("storymap.presentationTools.undoVertex")}
                    aria-label={t("storymap.presentationTools.undoVertex")}
                    onClick={() => setDraft((points) => points.slice(0, -1))}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1" onClick={cancelDrawing}>
                    <X className="h-3.5 w-3.5" />
                    {t("storymap.presentationTools.cancel")}
                  </Button>
                </div>
              </>
            )}
            <div className="flex gap-1 border-t pt-2">
              <Button
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 gap-1 text-xs"
                disabled={!chapterAnnotations.length || tool !== null || saved}
                onClick={() => {
                  useAppStore.getState().addGeoJsonLayer(
                    t("storymap.presentationTools.layerName", {
                      chapter: chapterTitle || chapterId,
                    }),
                    presentationAnnotationsCollection(chapterAnnotations),
                  );
                  setSavedAnnotations((current) => ({
                    ...current,
                    [chapterId]: chapterAnnotations,
                  }));
                }}
              >
                <Save className="h-3.5 w-3.5" />
                {t("storymap.presentationTools.save")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={!chapterAnnotations.length || tool !== null}
                aria-label={t("storymap.presentationTools.undoAnnotation")}
                title={t("storymap.presentationTools.undoAnnotation")}
                onClick={() => {
                  setAnnotations((current) => ({
                    ...current,
                    [chapterId]: (current[chapterId] ?? []).slice(0, -1),
                  }));
                }}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p
              role={saved ? "status" : undefined}
              className={cn("text-[11px]", saved ? "text-primary" : "text-muted-foreground")}
            >
              {t(
                saved ? "storymap.presentationTools.saved" : "storymap.presentationTools.temporary",
              )}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
