// Pure camera-pose math for 3D view exports (unit-tested, DOM-free).
//
// View conventions: +Z is front, +X is right/side, +Y is up/top. Poses are
// returned as plain vectors so any renderer can consume them — the
// model-viewer component maps them onto three.js.

export const VIEW_SPECS = ["front", "side", "top", "perspective"];

const VIEW_DIRECTIONS = {
  front: { x: 0, y: 0, z: 1 },
  side: { x: 1, y: 0, z: 0 },
  top: { x: 0, y: 1, z: 0 },
  perspective: { x: 1, y: 0.65, z: 1 },
};

export function normalizeVector(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Camera pose that frames `bbox` ({ center, size }) from a standard view.
 * `margin` scales the distance (1.0 touches the frustum, >1.0 adds padding)
 * and `fovRad` is the vertical field of view used for the distance math.
 * Unknown views fall back to `front`.
 */
export function viewCameraPose(
  bbox,
  view,
  margin = 1.3,
  fovRad = Math.PI / 6,
) {
  const center = bbox?.center ?? { x: 0, y: 0, z: 0 };
  const size = bbox?.size ?? { x: 1, y: 1, z: 1 };
  const radius = Math.max(size.x, size.y, size.z) / 2 || 0.5;
  const distance = (radius * margin) / Math.tan(fovRad / 2);
  const dir = normalizeVector(VIEW_DIRECTIONS[view] ?? VIEW_DIRECTIONS.front);
  return {
    position: {
      x: center.x + dir.x * distance,
      y: center.y + dir.y * distance,
      z: center.z + dir.z * distance,
    },
    target: { x: center.x, y: center.y, z: center.z },
    distance,
  };
}

const MIME_FORMATS = {
  "model/gltf-binary": "gltf",
  "model/gltf+json": "gltf",
  "model/obj": "obj",
};

/**
 * Map a filename, stored format, or MIME type onto the viewer loader format:
 * glb/gltf share the GLTF loader, obj is standalone. Everything else (fbx,
 * usd, usdz, stl, unknown) is not previewable and returns null.
 */
export function modelFormatForFile(nameOrFormat) {
  const str = String(nameOrFormat ?? "").toLowerCase();
  if (MIME_FORMATS[str]) return MIME_FORMATS[str];
  const ext = str.split(".").pop() ?? "";
  if (ext === "glb" || ext === "gltf") return "gltf";
  if (ext === "obj") return "obj";
  return null;
}
