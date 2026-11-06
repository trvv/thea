/** Projection and depth ordering depend on geometry and the camera, never on preset identity. */
import { dimensionCellSize } from "../recipes/dimensions.js";
import { depthOrder } from "./depth-order.js";
import { spaces } from "../recipes/spaces.js";

export const projectedPointSize = (depth) => (1.5 * 3.5) / (3.5 - depth);

export function projectPoints(prepared, job, scratch, compute = null) {
  const { configuration: config, columns: width, rows: height } = job;
  const spatial = spaces[config.space].length === 3;
  const { yaw, pitch } = job.rotation || { yaw: -0.6, pitch: 0.45 };
  const grid = config.footprint
    ? config.footprint === "grid"
    : config.position.some(
        (factor) =>
          factor === "column" ||
          factor === "row" ||
          (factor?.op === "factor" && ["column", "row"].includes(factor.name)),
      );
  const scale = job.pointScale || 1;
  const cellSpan = Math.min(
    ...Object.values(prepared.grid.dimensions).map(dimensionCellSize),
  );
  const cellWidth = grid
    ? Math.max(scale, width * dimensionCellSize(prepared.grid.dimensions.width))
    : Math.max(1, scale) * 1.5;
  const cellHeight = grid
    ? Math.max(
        scale,
        height * dimensionCellSize(prepared.grid.dimensions.height),
      )
    : cellWidth;
  const key = JSON.stringify([
    width,
    height,
    config.space,
    spatial ? yaw : 0,
    spatial ? pitch : 0,
    scale,
    grid,
    Boolean(compute),
  ]);
  if (scratch.geometry === prepared.geometry && scratch.key === key)
    return { ...scratch.projection, state: scratch.projection, reused: true };
  const started = performance.now(),
    cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  if (!scratch.projected || scratch.projected.length < prepared.size * 4) {
    scratch.projected = new Float32Array(prepared.size * 4);
    scratch.order = new Uint32Array(prepared.size);
  }
  const projected = scratch.projected,
    focal = Math.max(0, Math.min(width - 1, height - 1)) * 0.8;
  let computed;
  if (spatial && compute) {
    try {
      computed = compute.project(prepared, job, { grid, cellSpan });
    } catch {
      compute.failed = true;
      computed = null;
    }
  }
  if (computed) projected.set(computed);
  for (let i = 0; !computed && i < prepared.size; i++) {
    const p = i * 3,
      q = i * 4,
      x = prepared.positions[p],
      y = prepared.positions[p + 1],
      z = prepared.positions[p + 2];
    if (spatial) {
      const rx = x * cy + z * sy,
        rz = z * cy - x * sy,
        ry = y * cp - rz * sp,
        depth = y * sp + rz * cp;
      if (depth >= 3.5) {
        projected[q] = projected[q + 1] = projected[q + 3] = 0;
        projected[q + 2] = depth;
        continue;
      }
      projected[q] = (width - 1) / 2 + (rx * focal) / (3.5 - depth);
      projected[q + 1] = (height - 1) / 2 - (ry * focal) / (3.5 - depth);
      projected[q + 2] = depth;
      projected[q + 3] =
        (grid
          ? Math.max(
              projectedPointSize(depth) * scale,
              ((2 * focal) / (3.5 - depth)) * cellSpan,
            )
          : projectedPointSize(depth) * scale) / 2;
    } else {
      const circle = config.space === "circle",
        radius = circle ? Math.min(width, height) / 2 : 0;
      projected[q] = circle ? width / 2 + x * radius : ((x + 1) * width) / 2;
      projected[q + 1] = circle
        ? height / 2 + y * radius
        : ((y + 1) * height) / 2;
      projected[q + 2] = 0;
      projected[q + 3] = 1;
    }
  }
  const projection = performance.now() - started,
    sortStarted = performance.now();
  const order = spatial ? scratch.order.subarray(0, prepared.size) : null;
  if (order) {
    depthOrder(projected, order, scratch);
  }
  scratch.geometry = prepared.geometry;
  scratch.key = key;
  scratch.projection = {
    projected,
    order,
    width,
    height,
    spatial,
    backend: computed ? "webgl" : "cpu",
    cellWidth,
    cellHeight,
  };
  return {
    ...scratch.projection,
    state: scratch.projection,
    reused: false,
    projection,
    sorting: performance.now() - sortStarted,
  };
}
