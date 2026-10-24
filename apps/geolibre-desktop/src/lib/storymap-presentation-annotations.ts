import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import { measureArea, measureLength } from "./geometry-measure";

export type PresentationTool = "point" | "text" | "line" | "polygon" | "distance" | "area";
export type PresentationCoordinate = [number, number];
export type PresentationGeometry = Point | LineString | Polygon;
export interface PresentationAnnotationProperties {
  chapterId: string;
  label: string;
  tool: PresentationTool;
  /** Metric values are retained when explicitly saved to a project layer. */
  distanceMeters?: number;
  areaSquareMeters?: number;
}
export type PresentationAnnotation = Feature<
  PresentationGeometry,
  PresentationAnnotationProperties
>;

/** Minimum distinct vertices needed to finish a presentation drawing. */
export function presentationToolMinimum(tool: PresentationTool): number {
  if (tool === "point" || tool === "text") return 1;
  return tool === "polygon" || tool === "area" ? 3 : 2;
}

/** Build a separate geometry; closing a polygon must not mutate its live draft. */
export function presentationGeometry(
  tool: PresentationTool,
  coordinates: PresentationCoordinate[],
): PresentationGeometry | null {
  if (
    coordinates.some(
      ([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90,
    )
  )
    return null;
  const distinct = new Set(coordinates.map((coordinate) => coordinate.join(","))).size;
  if (distinct < presentationToolMinimum(tool)) return null;
  const points = coordinates.map(([lng, lat]): PresentationCoordinate => [lng, lat]);
  if (tool === "point" || tool === "text") return { type: "Point", coordinates: points[0] };
  if (tool === "line" || tool === "distance") return { type: "LineString", coordinates: points };
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return { type: "Polygon", coordinates: [points] };
}

/** Session annotations are inert GeoJSON until the presenter explicitly saves. */
export function createPresentationAnnotation(
  tool: PresentationTool,
  coordinates: PresentationCoordinate[],
  chapterId: string,
  label: string,
  id: string,
): PresentationAnnotation | null {
  const geometry = presentationGeometry(tool, coordinates);
  if (!geometry) return null;
  const properties: PresentationAnnotationProperties = {
    chapterId,
    label: label.trim(),
    tool,
  };
  if (tool === "distance") properties.distanceMeters = measureLength(geometry);
  if (tool === "area") properties.areaSquareMeters = measureArea(geometry);
  return { type: "Feature", id, geometry, properties };
}

/** Saving a result layer cannot subsequently mutate the presentation session. */
export function presentationAnnotationsCollection(
  annotations: PresentationAnnotation[],
): FeatureCollection<PresentationGeometry, PresentationAnnotationProperties> {
  return { type: "FeatureCollection", features: structuredClone(annotations) };
}

/** Compact metric readouts (the unit symbols are language-neutral). */
export function presentationMeasurementLabel(
  annotation: PresentationAnnotation,
  locale?: string,
): string {
  const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const area = annotation.properties.areaSquareMeters;
  if (area !== undefined)
    return area >= 1_000_000 ? `${format(area / 1_000_000)} km²` : `${format(area)} m²`;
  const distance = annotation.properties.distanceMeters;
  if (distance !== undefined)
    return distance >= 1000 ? `${format(distance / 1000)} km` : `${format(distance)} m`;
  return "";
}
