/** Hit testing and recipe provenance for a particular displayed frame, computed only on request. */
import { compileRecipes, recipeRoots } from "./recipes.js";
import { appearanceChannelsFor } from "./factor-catalog.js";
import { defaultAppearance } from "./appearance.js";
import { preparePoints } from "./point-renderer.js";
import { projectPoints } from "./point-projection.js";
import { pointFactors } from "./point-factors.js";
import { resolveViewJob, spaces } from "./point-configuration.js";
import { dimensionCoordinate, dimensionNames } from "./dimensions.js";
import { frameKey } from "./render-identity.js";
import { sampleProvenance } from "./point-provenance.js";
import { inspectEncodings } from "./byte-interpretation.js";
import { inspectUTF8Grapheme } from "./grapheme-inspection.js";
import { describeSpectrumSample } from "./spectrum-sampling.js";
import { interpretNumber } from "./numeric-interpretation.js";
import { inspectByteContext } from "./occurrences.js";
import { describeSourceOffset } from "./source-metadata.js";
import { inspectDensity } from "./density.js";

/** Same footprint/probe rules as the CPU and WebGL rasterizers; later/deeper marks win overlap. */
export function hitPoint(prepared, projection, x, y) {
  const { width, height, projected, order, spatial, cellWidth, cellHeight } =
    projection;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height
  )
    return -1;
  const px = Math.floor(x),
    py = Math.floor(y);
  for (let n = prepared.size - 1; n >= 0; n--) {
    const i = order ? order[n] : n,
      q = i * 4,
      size = prepared.sizes[i];
    if (!prepared.colors[q + 3]) continue;
    const halfX = (spatial ? projected[q + 3] : cellWidth / 2) * size,
      halfY = (spatial ? projected[q + 3] : cellHeight / 2) * size;
    if (!(halfX > 0 && halfY > 0)) continue;
    if (
      Math.abs(px + 0.5 - projected[q]) > halfX + 0.5 ||
      Math.abs(py + 0.5 - projected[q + 1]) > halfY + 0.5
    )
      continue;
    for (let probe = 0; probe < 4; probe++) {
      const nx = (px + (probe & 1 ? 0.75 : 0.25) - projected[q]) / halfX,
        ny = (py + (probe & 2 ? 0.75 : 0.25) - projected[q + 1]) / halfY;
      if (
        prepared.shape === "circle"
          ? nx * nx + ny * ny <= 1
          : Math.abs(nx) <= 1 && Math.abs(ny) <= 1
      )
        return i;
    }
  }
  return -1;
}

export async function inspectPoint(
  input,
  renderCache,
  x,
  y,
  current = () => true,
) {
  if (!current()) return null;
  const job = resolveViewJob(input);
  // Borrow immutable buffers only. Histograms and projection scratch can mutate on the next render.
  const cache = {};
  for (const key of [
    "preparedPoints",
    "pointGeometry",
    "factorWindow",
    "factorEntropy",
    "factorSparse",
    "population",
  ])
    if (renderCache[key]) cache[key] = renderCache[key];
  if (renderCache.factorSpectrum)
    cache.factorSpectrum = { ...renderCache.factorSpectrum };
  if (renderCache.recipeEntropy)
    cache.recipeEntropy = {
      ...renderCache.recipeEntropy,
      values: new Map(renderCache.recipeEntropy.values),
    };
  let frame = renderCache.pointFrame;
  if (
    frame?.key !== frameKey(job) ||
    frame.source !== (job.sourceId ?? job.source)
  ) {
    const result = await preparePoints(job, cache, current);
    if (!result || !current()) return null;
    frame = {
      prepared: result.prepared,
      projection: projectPoints(result.prepared, job, {}),
    };
  } else if (
    renderCache.pointRaster?.projection &&
    frame.projection.state !== renderCache.pointRaster.projection
  ) {
    // Failed later raster work can overwrite projection scratch without presenting its frame.
    frame = { ...frame, projection: projectPoints(frame.prepared, job, {}) };
  }
  // Resolve the hit synchronously before any subsequent frame can overwrite projected scratch.
  const { prepared, projection } = frame,
    index = hitPoint(prepared, projection, x, y);
  if (index < 0 || !current()) return null;
  const projected = [
    ...projection.projected.subarray(index * 4, index * 4 + 4),
  ];
  const appearance =
    job.appearance ||
    defaultAppearance(job.region, job.shaders, job.frequencyOpacity);
  const accumulation = appearance.density
    ? inspectDensity(
        prepared,
        projection,
        x,
        y,
        appearance.density,
        job.densityReference ?? frame.density?.referenceValue,
      )
    : undefined;
  const roots = recipeRoots(job.configuration, appearance);
  if (prepared.text) roots.text = "value";
  const program = compileRecipes(roots, job.configuration.recipes);
  const visit = await pointFactors(job, appearance, cache, current, program);
  if (!visit || !current()) return null;
  let result;
  visit(
    (factors, label, context) => {
      const provenance = sampleProvenance(
          job,
          visit.provenance,
          factors,
          context,
        ),
        nodes = [];
      const evaluate = program.createEvaluator((node, value) => {
        const entry = {
          ...node,
          value,
          ...(node.op === "constant" ? { literal: node.value } : {}),
        };
        if (node.op === "factor")
          entry.source = provenance.describeFactor(node.name);
        if (node.op === "hilbert" || node.op === "hilbert3d") {
          const dimensions = node.op === "hilbert3d" ? 3 : 2,
            exact = program.nodes[node.args[0]].type === "index";
          const size =
            dimensions === 3 || exact ? context.pointCount : context.length;
          entry.resolvedOrder =
            node.order ||
            Math.min(
              dimensions === 3 ? 10 : 15,
              Math.ceil(Math.log2(Math.max(1, size)) / dimensions),
            );
          const cells = 2 ** (entry.resolvedOrder * dimensions),
            input = nodes[node.args[0]].value;
          entry.curveIndex = exact
            ? Math.max(0, Math.min(cells - 1, input))
            : Math.min(
                cells - 1,
                Math.floor(Math.max(0, Math.min(1, input)) * cells),
              );
        }
        if (node.op === "linear") entry.grid = context.grid;
        if (node.op === "byte")
          entry.source = provenance.describeByte(nodes[node.args[0]].value);
        if (node.op === "analysis")
          entry.source = provenance.describeAnalysis(
            nodes[node.args[0]].value,
            node,
          );
        if (node.op === "number") {
          const offset = Math.floor(nodes[node.args[0]].value);
          const interpreted = interpretNumber(
            visit.provenance.bytes,
            offset,
            node,
          );
          entry.source = {
            ...interpreted,
            selectionOffset: offset,
            sourceRange: {
              start: job.offset + offset,
              endExclusive: job.offset + offset + interpreted.width,
            },
          };
        }
        if (node.op === "entropy")
          entry.source = provenance.describeEntropy(
            nodes[node.args[0]].value,
            node.window,
          );
        if (node.op === "spectrum" && node.interpolation === "complex")
          entry.source = {
            ...describeSpectrumSample(
              visit.provenance.spectrum,
              job.length,
              node.kind,
              nodes[node.args[0]].value,
              "complex",
            ),
            selection: {
              start: job.offset,
              endExclusive: job.offset + job.length,
            },
          };
        else if (node.op === "spectrum")
          entry.source = provenance.describeSpectrum(
            Math.min(
              visit.provenance.bins - 1,
              Math.floor(
                Math.max(0, Math.min(1, nodes[node.args[0]].value)) *
                  visit.provenance.bins,
              ),
            ),
          );
        nodes.push(entry);
      });
      evaluate(factors, context);
      const traits = [];
      for (const [axis, name] of spaces[job.configuration.space].entries()) {
        const key = `p${axis}`,
          value =
            program.bindings[key] === undefined
              ? 0.5
              : factors[program.bindings[key]],
          range = visit.grid.dimensions[dimensionNames[axis]];
        const inverted = job.configuration.inverted[axis];
        traits.push({
          name,
          expression: roots[key] ?? "none",
          value,
          root: program.outputs[key],
          mapping: {
            inverted,
            range,
            mappedValue: dimensionCoordinate(
              inverted ? 1 - value : value,
              range,
            ),
          },
        });
      }
      for (const name of appearanceChannelsFor(appearance)) {
        const value =
          program.bindings[name] === undefined
            ? undefined
            : factors[program.bindings[name]];
        const rendered = ["red", "green", "blue"].includes(name)
          ? (value ?? 0) * 255
          : name === "hue"
            ? (value ?? 0) * 300
            : name === "saturation"
              ? (value ?? (appearance.hue === "none" ? 0 : 0.75))
              : name === "lightness"
                ? value === undefined
                  ? appearance.hue !== "none" ||
                    appearance.saturation !== "none"
                    ? 0.5
                    : 1
                  : appearance.hue !== "none" ||
                      appearance.saturation !== "none"
                    ? 0.15 + 0.7 * value
                    : value
                : name === "opacity"
                  ? (value ?? 1)
                  : value === undefined
                    ? 1
                    : 0.5 + 1.5 * value;
        traits.push({
          name: name[0].toUpperCase() + name.slice(1),
          expression: appearance[name],
          value,
          root: program.outputs[name],
          rendered,
        });
      }
      if (prepared.text)
        traits.push({
          name: "Text",
          expression: "value",
          value: label,
          root: program.outputs.text,
          mapping: {
            mode: job.shaders.includes("hex") ? "hex" : "character",
            encoding: job.encoding,
            blankSpaces: job.blankSpaces,
            blankNulls: job.blankNulls,
          },
        });
      result = {
        point: provenance.point,
        traits,
        nodes,
        rendering: {
          space: job.configuration.space,
          coordinates: [
            ...prepared.positions.subarray(index * 3, index * 3 + 3),
          ],
          rgba: [...prepared.colors.subarray(index * 4, index * 4 + 4)],
          size: prepared.sizes[index],
          shape: prepared.shape,
          footprint: job.configuration.footprint,
          ...(accumulation ? { accumulation } : {}),
          raster: { width: projection.width, height: projection.height },
          pointScale: job.pointScale || 1,
          projection: {
            x: projected[0],
            y: projected[1],
            depth: projected[2],
            halfWidth:
              (projection.spatial ? projected[3] : projection.cellWidth / 2) *
              prepared.sizes[index],
            halfHeight:
              (projection.spatial ? projected[3] : projection.cellHeight / 2) *
              prepared.sizes[index],
          },
          rotation: projection.spatial
            ? job.rotation || { yaw: -0.6, pitch: 0.45 }
            : undefined,
          ...(prepared.text
            ? {
                text: label,
                encoding: job.encoding,
                blankSpaces: job.blankSpaces,
                blankNulls: job.blankNulls,
              }
            : {}),
        },
      };
    },
    prepared.geometry.indices[index],
    prepared.geometry.indices[index] + 1,
  );
  if (!result || !current()) return null;
  const missingByte =
    ["bytes", "symbols"].includes(result.point.population) &&
    result.point.byteValue === undefined;
  const missingTuple =
    ["pairs", "triples"].includes(result.point.population) &&
    !result.point.tuple;
  if (missingByte || missingTuple) {
    const width = missingTuple
      ? result.point.population === "pairs"
        ? 2
        : 3
      : 1;
    const bytes = new Uint8Array(
      await job.source
        .slice(result.point.sourceOffset, result.point.sourceOffset + width)
        .arrayBuffer(),
    );
    if (!current()) return null;
    if (missingTuple) result.point.tuple = [...bytes];
    else result.point.byteValue = bytes[0];
  }
  const byteOrigin = result.point.byteCorrespondence || result.point;
  if (job.sourceMetadata)
    byteOrigin.metadata = describeSourceOffset(
      job.sourceMetadata,
      byteOrigin.sourceOffset,
    );
  const encodings = await inspectEncodings(
    job.source,
    byteOrigin.sourceOffset,
    current,
  );
  if (!current()) return null;
  const utf8 = encodings?.find((candidate) => candidate.encoding === "UTF-8");
  if (utf8)
    byteOrigin.utf8 = {
      ...utf8,
      sourceOffset: byteOrigin.sourceOffset,
      relationship:
        result.point.population === "bins"
          ? "byte correspondence"
          : result.point.sampleRange
            ? "sample representative byte"
            : result.point.population === "bytes"
              ? "source byte"
              : result.point.population === "records"
                ? "record start byte"
                : `${result.point.representative || "first occurrence"} byte`,
    };
  const alternatives =
    encodings?.filter((candidate) => candidate.encoding !== "UTF-8") || [];
  if (alternatives.length)
    byteOrigin.encodings = Object.fromEntries(
      alternatives.map((candidate, index) => [
        `Candidate ${index + 1}`,
        candidate,
      ]),
    );
  if (utf8) {
    const grapheme = await inspectUTF8Grapheme(
      job.source,
      byteOrigin.sourceOffset,
      {},
      current,
    );
    if (!current()) return null;
    if (grapheme)
      byteOrigin.grapheme = {
        ...grapheme,
        scalars: Object.fromEntries(
          grapheme.scalars.map((scalar, index) => [
            `Scalar ${index + 1}`,
            scalar,
          ]),
        ),
      };
  }
  byteOrigin.context = await inspectByteContext(
    job.source,
    byteOrigin.sourceOffset,
    {},
    current,
  );
  if (!current()) return null;
  return result;
}
