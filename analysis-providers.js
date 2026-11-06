/** Prepared statistics with exact selected scopes and bounded requested-result storage. */
import { analysisModelKey, analysisParameters } from "./analysis-parameters.js";
import { assertProviderBudget } from "./provider-budget.js";
import { scanChunkSize, mapEntryEstimate, yieldScan } from "./scan.js";
import { recordProvider } from "./provider-diagnostics.js";
import { prepareRepetition } from "./repetition.js";
import { prepareLocalSpectra, localFrame } from "./local-spectrum.js";
import { encodingCandidate, encodingResult } from "./encoding-analysis.js";
import {
  prepareReference,
  scorePreparedReference,
} from "./reference-models.js";
import {
  prepareOccurrence,
  occurrenceStorage,
  occurrenceResult,
  describeOccurrence,
} from "./occurrence-analysis.js";
import {
  prepareReduction,
  reductionStorage,
  reductionResult,
  describeReduction,
} from "./occurrence-reductions.js";

const clip = (value, length) => Math.max(0, Math.min(length, value));
const nlog = (value) => (value ? value * Math.log2(value) : 0);
const binaryEntropy = (probability) =>
  probability > 0 && probability < 1
    ? -probability * Math.log2(probability) -
      (1 - probability) * Math.log2(1 - probability)
    : 0;

function requestSignature(program) {
  const signatures = new Map();
  const expression = (id) => {
    if (signatures.has(id)) return signatures.get(id);
    const { id: ignored, args, ...definition } = program.nodes[id];
    const result = [definition, args.map(expression)];
    signatures.set(id, result);
    return result;
  };
  return JSON.stringify(
    [
      ...new Set(
        program.nodes
          .filter((node) => node.op === "analysis")
          .map((node) =>
            JSON.stringify([analysisModelKey(node), expression(node.args[0])]),
          ),
      ),
    ].sort(),
  );
}

/** Apply the symmetric difference between two half-open windows, skipping disjoint gaps. */
function moveWindow(state, start, end, update) {
  for (let i = state.start; i < Math.min(state.end, start); i++) update(i, -1);
  for (let i = Math.max(state.start, end); i < state.end; i++) update(i, -1);
  for (let i = start; i < Math.min(end, state.start); i++) update(i, 1);
  for (let i = Math.max(start, state.end); i < end; i++) update(i, 1);
  state.start = start;
  state.end = end;
}

function centeredRange(index, window, length) {
  return [
    clip(index - Math.floor(window / 2), length),
    clip(index + window - Math.floor(window / 2), length),
  ];
}

async function conditionalModel(bytes, current) {
  const joint = new Float64Array(65536),
    rows = new Float64Array(256);
  for (let start = 1; start < bytes.length; start += scanChunkSize) {
    const end = Math.min(bytes.length, start + scanChunkSize);
    for (let i = start; i < end; i++) {
      const previous = bytes[i - 1];
      joint[previous * 256 + bytes[i]]++;
      rows[previous]++;
    }
    if (end < bytes.length && !(await yieldScan(current))) return null;
  }
  return { joint, rows };
}

/** A rolling joint table serves equality, numeric difference and mutual information together. */
async function prepareLag(bytes, parameters, indices, results, current) {
  const joint = new Float64Array(65536),
    rows = new Float64Array(256),
    columns = new Float64Array(256);
  const state = { start: 0, end: 0 };
  let pairs = 0,
    equal = 0,
    difference = 0,
    jointSum = 0,
    rowSum = 0,
    columnSum = 0;
  const update = (index, delta) => {
    const previous = bytes[index - parameters.lag],
      value = bytes[index];
    const key = previous * 256 + value;
    jointSum += nlog(joint[key] + delta) - nlog(joint[key]);
    rowSum += nlog(rows[previous] + delta) - nlog(rows[previous]);
    columnSum += nlog(columns[value] + delta) - nlog(columns[value]);
    joint[key] += delta;
    rows[previous] += delta;
    columns[value] += delta;
    pairs += delta;
    if (previous === value) equal += delta;
    difference += Math.abs(previous - value) * delta;
  };
  for (let ordinal = 0; ordinal < indices.length; ordinal++) {
    const index = indices[ordinal];
    const [left, right] =
      parameters.window === 0
        ? [0, bytes.length]
        : centeredRange(index, parameters.window, bytes.length);
    const end = right;
    const start = Math.min(end, Math.max(parameters.lag, left));
    moveWindow(state, start, end, update);
    const information = pairs
      ? Math.max(
          0,
          Math.min(
            8,
            Math.log2(pairs) + (jointSum - rowSum - columnSum) / pairs,
          ),
        )
      : 0;
    results.set(index, [
      pairs ? equal / pairs : 0,
      pairs ? difference / (pairs * 255) : 0,
      information,
      pairs,
    ]);
    if (ordinal % 1024 === 1023 && !(await yieldScan(current))) return false;
  }
  return current();
}

async function prepareDistribution(
  bytes,
  parameters,
  indices,
  results,
  current,
) {
  const leftCounts = new Float64Array(256),
    rightCounts = new Float64Array(256);
  const left = { start: 0, end: 0 },
    right = { start: 0, end: 0 };
  for (let ordinal = 0; ordinal < indices.length; ordinal++) {
    const index = indices[ordinal];
    moveWindow(
      left,
      clip(index - parameters.gap - parameters.window, bytes.length),
      clip(index - parameters.gap, bytes.length),
      (i, delta) => {
        leftCounts[bytes[i]] += delta;
      },
    );
    moveWindow(
      right,
      clip(index + parameters.gap, bytes.length),
      clip(index + parameters.gap + parameters.window, bytes.length),
      (i, delta) => {
        rightCounts[bytes[i]] += delta;
      },
    );
    const leftSize = left.end - left.start,
      rightSize = right.end - right.start;
    let variation = 0,
      divergence = 0;
    if (leftSize && rightSize) {
      for (let byte = 0; byte < 256; byte++) {
        const p = leftCounts[byte] / leftSize,
          q = rightCounts[byte] / rightSize;
        const mixture = (p + q) / 2;
        variation += Math.abs(p - q) / 2;
        if (p) divergence += (p * Math.log2(p / mixture)) / 2;
        if (q) divergence += (q * Math.log2(q / mixture)) / 2;
      }
    }
    results.set(index, [
      Math.max(0, Math.min(1, variation)),
      Math.max(0, Math.min(1, divergence)),
      leftSize,
      rightSize,
    ]);
    if (ordinal % 1024 === 1023 && !(await yieldScan(current))) return false;
  }
  return current();
}

async function prepareBits(bytes, parameters, indices, results, current) {
  const counts = new Float64Array(8),
    state = { start: 0, end: 0 };
  const update = (index, delta) => {
    const value = bytes[index];
    for (let bit = 0; bit < 8; bit++)
      counts[bit] += ((value >> bit) & 1) * delta;
  };
  for (let ordinal = 0; ordinal < indices.length; ordinal++) {
    const index = indices[ordinal];
    const [start, end] = centeredRange(index, parameters.window, bytes.length);
    moveWindow(state, start, end, update);
    results.set(index, [end - start, ...counts]);
    if (ordinal % 1024 === 1023 && !(await yieldScan(current))) return false;
  }
  return current();
}

function resultProjection(result, parameters) {
  if (parameters.family === "encoding")
    return result[
      { codePoint: 0, length: 1, byteIndex: 2, valid: 3 }[parameters.kind]
    ];
  if (parameters.family === "reference")
    return result[{ surprise: 0, coverage: 1, valid: 2 }[parameters.kind]];
  if (parameters.family === "repetition")
    return result[{ distance: 1, length: 2, valid: 3 }[parameters.kind]];
  if (parameters.family === "spectral")
    return result[
      { energy: 0, valid: 1, power: 2, totalPower: 3 }[parameters.kind]
    ];
  if (parameters.family === "lag") {
    if (parameters.kind === "valid") return result[3] > 0 ? 1 : 0;
    return result[
      { equality: 0, difference: 1, information: 2, pairs: 3 }[parameters.kind]
    ];
  }
  if (parameters.family === "distribution") {
    if (parameters.kind === "valid")
      return result[2] > 0 && result[3] > 0 ? 1 : 0;
    return result[parameters.kind === "variation" ? 0 : 1];
  }
  const count = result[parameters.bit + 1],
    length = result[0];
  if (parameters.kind === "valid") return length > 0 ? 1 : 0;
  if (parameters.kind === "count") return count;
  const bias = length ? count / length : 0;
  return parameters.kind === "entropy" ? binaryEntropy(bias) : bias;
}

function conditionalProjection(model, bytes, index, parameters) {
  if (index < 1 || index >= bytes.length) return 0;
  if (parameters.kind === "valid") return 1;
  const previous = bytes[index - 1],
    value = bytes[index];
  const probability =
    (model.joint[previous * 256 + value] + parameters.alpha) /
    (model.rows[previous] + 256 * parameters.alpha);
  return parameters.kind === "surprise" ? -Math.log2(probability) : probability;
}

/**
 * Providers collect actual requested addresses during preparation and publish whole batches.
 * The normal synchronous point visitor performs only lookups and scalar projections afterward.
 */
export async function prepareAnalysisProviders(
  job,
  bytes,
  program,
  cache,
  current,
  diagnostics,
) {
  if (!program.providers.analysis?.length) return undefined;
  const source = job.sourceId ?? job.source;
  const key = JSON.stringify([
    job.offset,
    job.length,
    requestSignature(program),
    job.configuration.population,
    job.configuration.sampleLimit,
    job.configuration.sampling,
    job.configuration.dimensions,
    job.configuration.tupleRepresentative,
    job.configuration.providerBudget,
    job.sampleLayout,
    job.referenceModels?.map((model) => [model.id, model.revision]),
  ]);
  const previous = cache.analysisProviders;
  const reused = previous?.source === source && previous.key === key;
  const started = diagnostics ? performance.now() : 0;
  const groups = reused ? previous.groups : new Map();
  for (const parameters of program.providers.analysis) {
    const modelKey = analysisModelKey(parameters);
    if (!groups.has(modelKey))
      groups.set(modelKey, {
        parameters,
        results: new Map(),
        pending: new Set(),
      });
  }
  const needsConditional = [...groups.values()].some(
    (group) => group.parameters.family === "conditional",
  );
  let retainedBytes =
    bytes.buffer.byteLength + (needsConditional ? (65536 + 256) * 8 : 0);
  for (const group of groups.values()) {
    if (group.parameters.family !== "reference") continue;
    const artifact = job.referenceModels?.find(
      (model) => model.id === group.parameters.modelID,
    );
    if (!artifact)
      throw new TypeError(
        `Reference model is unavailable: ${group.parameters.modelID}`,
      );
    if (
      !group.reference ||
      group.reference.model.revision !== artifact.revision
    )
      group.reference = prepareReference(artifact);
    retainedBytes +=
      group.reference.negativeLogProbabilities.byteLength +
      group.reference.model.counts.length * 8;
  }
  const temporaryBytes = [...groups.values()].some(
    (group) => group.parameters.family === "lag",
  )
    ? (65536 + 512) * 8
    : [...groups.values()].some(
          (group) => group.parameters.family === "distribution",
        )
      ? 512 * 8
      : 8 * 8;
  // One rolling joint table is temporary; output results are budgeted as they are requested.
  assertProviderBudget(
    job,
    retainedBytes + temporaryBytes,
    "Statistical provider preparation",
  );
  const sameConditionalScope =
    previous?.source === source &&
    previous.scopeOffset === job.offset &&
    previous.scopeLength === job.length;
  const conditional = needsConditional
    ? sameConditionalScope && previous.conditional
      ? previous.conditional
      : await conditionalModel(bytes, current)
    : undefined;
  if (!current() || (needsConditional && !conditional)) return null;
  const occurrences = new Map();
  for (const group of groups.values()) {
    if (
      group.parameters.family !== "occurrence" ||
      occurrences.has(group.parameters.width)
    )
      continue;
    const width = group.parameters.width;
    const model =
      sameConditionalScope && previous.occurrences?.has(width)
        ? previous.occurrences.get(width)
        : await prepareOccurrence(bytes, width, current, (extra, label) =>
            assertProviderBudget(
              job,
              retainedBytes + temporaryBytes + extra,
              label,
            ),
          );
    if (!model || !current()) return null;
    occurrences.set(width, model);
    retainedBytes += occurrenceStorage(model);
    assertProviderBudget(
      job,
      retainedBytes + temporaryBytes,
      "Statistical provider storage",
    );
  }
  const reductions = new Map();
  for (const group of groups.values()) {
    if (group.parameters.family !== "reduction") continue;
    const modelKey = analysisModelKey(group.parameters);
    const model =
      sameConditionalScope && previous.reductions?.has(modelKey)
        ? previous.reductions.get(modelKey)
        : await prepareReduction(
            bytes,
            group.parameters,
            current,
            (extra, label) =>
              assertProviderBudget(
                job,
                retainedBytes + temporaryBytes + extra,
                label,
              ),
          );
    if (!model || !current()) return null;
    reductions.set(modelKey, model);
    retainedBytes += reductionStorage(model);
    assertProviderBudget(
      job,
      retainedBytes + temporaryBytes,
      "Occurrence reduction storage",
    );
  }
  let resultEntries = [...groups.values()].reduce(
    (sum, group) => sum + group.results.size,
    0,
  );
  const provider = {
    source,
    key,
    scopeOffset: job.offset,
    scopeLength: job.length,
    groups,
    conditional,
    occurrences,
    reductions,
    lookup(index, parameters) {
      index = Math.floor(index);
      if (!(index >= 0 && index < bytes.length)) return 0;
      if (parameters.family === "conditional")
        return conditionalProjection(conditional, bytes, index, parameters);
      if (parameters.family === "occurrence")
        return occurrenceResult(
          bytes,
          index,
          parameters,
          occurrences.get(parameters.width),
        );
      if (parameters.family === "reduction")
        return reductionResult(
          bytes,
          index,
          parameters,
          reductions.get(analysisModelKey(parameters)),
        );
      const group = groups.get(analysisModelKey(parameters));
      const resultIndex =
        parameters.family === "lag" && parameters.window === 0 ? 0 : index;
      const result = group.results.get(resultIndex);
      if (result) return resultProjection(result, parameters);
      if (!group.pending.has(resultIndex)) {
        assertProviderBudget(
          job,
          retainedBytes +
            (resultEntries + 1) * (mapEntryEstimate + 9 * 8) +
            temporaryBytes,
          "Statistical result preparation",
        );
        group.pending.add(resultIndex);
        resultEntries++;
      }
      return 0;
    },
    get pending() {
      return [...groups.values()].some((group) => group.pending.size > 0);
    },
    async preparePending() {
      for (const group of groups.values()) {
        if (!group.pending.size) continue;
        const indices = [...group.pending].sort((a, b) => a - b);
        let prepared;
        if (group.parameters.family === "encoding") {
          prepared = new Map();
          for (const index of indices)
            prepared.set(index, encodingResult(bytes, index, group.parameters));
        } else if (group.parameters.family === "reference") {
          prepared = new Map();
          for (let ordinal = 0; ordinal < indices.length; ordinal++) {
            const index = indices[ordinal];
            const [start, end] = centeredRange(
              index,
              group.parameters.window,
              bytes.length,
            );
            const score = scorePreparedReference(group.reference, bytes, {
              start,
              end,
            });
            prepared.set(index, [
              score.negativeLogLikelihood ?? 0,
              score.coverage,
              score.valid ? 1 : 0,
              score.itemCount,
              score.seenCount,
            ]);
            if (ordinal % 256 === 255 && !(await yieldScan(current)))
              return false;
          }
        } else if (
          ["repetition", "spectral"].includes(group.parameters.family)
        ) {
          const prepare =
            group.parameters.family === "repetition"
              ? prepareRepetition
              : prepareLocalSpectra;
          const checkBudget = (extra, label) =>
            assertProviderBudget(
              job,
              retainedBytes +
                resultEntries * (mapEntryEstimate + 9 * 8) +
                extra,
              label,
            );
          prepared = await prepare(
            bytes,
            group.parameters,
            indices,
            current,
            checkBudget,
          );
          if (!prepared) return false;
        } else {
          prepared = new Map();
          const prepare = {
            lag: prepareLag,
            distribution: prepareDistribution,
            bit: prepareBits,
          }[group.parameters.family];
          if (
            !(await prepare(
              bytes,
              group.parameters,
              indices,
              prepared,
              current,
            ))
          )
            return false;
        }
        if (!current()) return false;
        for (const [index, result] of prepared)
          group.results.set(index, result);
        group.pending.clear();
      }
      return current();
    },
    publish() {
      if (!current()) return false;
      cache.analysisProviders = provider;
      recordProvider(diagnostics, "analysis", started, !reused);
      return true;
    },
    describe(index, expression) {
      index = Math.floor(index);
      const parameters = analysisParameters(expression);
      const selection = {
        start: job.offset,
        endExclusive: job.offset + job.length,
      };
      const result = {
        ...parameters,
        selectionOffset: index,
        sourceOffset: job.offset + index,
        selection,
      };
      if (!(index >= 0 && index < bytes.length))
        return { ...result, valid: false, boundary: "zero outside selection" };
      if (parameters.family === "conditional") {
        if (!index)
          return {
            ...result,
            valid: false,
            boundary: "no selected predecessor",
          };
        const previous = bytes[index - 1],
          value = bytes[index];
        const probability = conditionalProjection(conditional, bytes, index, {
          ...parameters,
          kind: "probability",
        });
        return {
          ...result,
          valid: true,
          training: "selected interval, including scored transition",
          previous: { sourceOffset: job.offset + index - 1, value: previous },
          current: { sourceOffset: job.offset + index, value },
          transitionCount: conditional.joint[previous * 256 + value],
          rowCount: conditional.rows[previous],
          probability,
          surpriseBits: -Math.log2(probability),
        };
      }
      if (parameters.family === "occurrence")
        return {
          ...result,
          ...describeOccurrence(
            bytes,
            index,
            parameters,
            occurrences.get(parameters.width),
          ),
          sourceRange: {
            start: job.offset + index,
            endExclusive:
              job.offset + Math.min(bytes.length, index + parameters.width),
          },
        };
      if (parameters.family === "reduction")
        return {
          ...result,
          ...describeReduction(
            bytes,
            index,
            parameters,
            reductions.get(analysisModelKey(parameters)),
          ),
          sourceRange: {
            start: job.offset + index,
            endExclusive:
              job.offset + Math.min(bytes.length, index + parameters.width),
          },
        };
      const group = groups.get(analysisModelKey(parameters));
      if (parameters.family === "encoding") {
        const candidate = encodingCandidate(bytes, index, parameters);
        return {
          ...result,
          valid: !!candidate,
          ...(candidate
            ? {
                ...candidate,
                sourceRange: {
                  start: job.offset + candidate.sourceRange.start,
                  endExclusive: job.offset + candidate.sourceRange.endExclusive,
                },
                normalization:
                  "scalar / U+10FFFF; length and byte index are raw integers",
              }
            : { boundary: "no complete aligned scalar inside selection" }),
        };
      }
      if (parameters.family === "reference") {
        const [start, end] = centeredRange(
          index,
          parameters.window,
          bytes.length,
        );
        const score = scorePreparedReference(group.reference, bytes, {
          start,
          end,
        });
        return {
          ...result,
          ...score,
          sourceRange: {
            start: job.offset + start,
            endExclusive: job.offset + end,
          },
          units: "bits per scored gram",
          interpretation:
            "reference resemblance, not calibrated class probability",
        };
      }
      const value = group.results.get(
        parameters.family === "lag" && parameters.window === 0 ? 0 : index,
      );
      if (!value)
        return {
          ...result,
          valid: false,
          boundary: "unprepared statistical address",
        };
      if (parameters.family === "repetition") {
        const earliest = Math.max(0, index - parameters.history);
        const previous = value[0];
        return {
          ...result,
          valid: !!value[3],
          blockWidth: 4,
          candidatePolicy: "nearest previous exact four-byte block",
          extensionPolicy:
            "extend chosen nearest candidate; not global longest match",
          searchStartRange: {
            start: job.offset + earliest,
            endExclusive:
              job.offset +
              Math.max(earliest, index - (parameters.overlap ? 0 : 3)),
          },
          currentRange: {
            start: job.offset + index,
            endExclusive:
              job.offset +
              Math.min(bytes.length, index + Math.max(4, value[2])),
          },
          bytes: [...bytes.subarray(index, index + Math.max(4, value[2]))],
          previousRange: value[3]
            ? {
                start: job.offset + previous,
                endExclusive: job.offset + previous + value[2],
              }
            : undefined,
          distance: value[1],
          matchLength: value[2],
        };
      }
      if (parameters.family === "spectral") {
        const frame = localFrame(bytes, parameters, value[4]);
        return {
          ...result,
          valid: !!value[1],
          relativeBandEnergy: value[0],
          bandPower: value[2],
          totalPower: value[3],
          requestedFrameRange: {
            start: job.offset + value[4],
            endExclusive: job.offset + value[5],
          },
          sourceRange: {
            start: job.offset + clip(value[4], bytes.length),
            endExclusive: job.offset + clip(value[5], bytes.length),
          },
          sampleCount: value[6],
          firstBin: value[7],
          lastBin: value[8],
          padding: {
            before: Math.min(parameters.window, Math.max(0, -value[4])),
            after: Math.min(
              parameters.window,
              Math.max(0, value[5] - bytes.length),
            ),
          },
          taperDefinition:
            parameters.taper === "hann"
              ? "periodic Hann: 0.5 - 0.5*cos(2*pi*n/N)"
              : "rectangular: 1",
          powerDefinition:
            "one-sided endpoint weights 1 at DC/Nyquist, 2 interior; suppress coefficient power below peak * 1e-20; no amplitude normalization",
          bandEndpoints: "both included, cycles per byte",
          samples: frame.samples ? [...frame.samples] : undefined,
          real: frame.real
            ? [...frame.real.subarray(0, Math.floor(parameters.window / 2) + 1)]
            : undefined,
          imaginary: frame.imaginary
            ? [
                ...frame.imaginary.subarray(
                  0,
                  Math.floor(parameters.window / 2) + 1,
                ),
              ]
            : undefined,
        };
      }
      if (parameters.family === "lag") {
        const [left, right] =
          parameters.window === 0
            ? [0, bytes.length]
            : centeredRange(index, parameters.window, bytes.length);
        const start = Math.min(right, Math.max(parameters.lag, left));
        const end = right;
        return {
          ...result,
          valid: value[3] > 0,
          pairs: value[3],
          equality: value[0],
          meanAbsoluteDifference: value[1] * 255,
          normalizedDifference: value[1],
          differenceNormalization: 255,
          mutualInformationBits: value[2],
          currentRange: {
            start: job.offset + start,
            endExclusive: job.offset + end,
          },
          previousRange: value[3]
            ? {
                start: job.offset + start - parameters.lag,
                endExclusive: job.offset + end - parameters.lag,
              }
            : undefined,
        };
      }
      if (parameters.family === "distribution") {
        const leftRange = [
          clip(index - parameters.gap - parameters.window, bytes.length),
          clip(index - parameters.gap, bytes.length),
        ];
        const rightRange = [
          clip(index + parameters.gap, bytes.length),
          clip(index + parameters.gap + parameters.window, bytes.length),
        ];
        const counts = (range) => {
          const result = {};
          for (let i = range[0]; i < range[1]; i++)
            result[bytes[i]] = (result[bytes[i]] || 0) + 1;
          return result;
        };
        return {
          ...result,
          valid: value[2] > 0 && value[3] > 0,
          totalVariation: value[0],
          jensenShannonDivergenceBits: value[1],
          leftCount: value[2],
          rightCount: value[3],
          leftRange: {
            start: job.offset + leftRange[0],
            endExclusive: job.offset + leftRange[1],
          },
          rightRange: {
            start: job.offset + rightRange[0],
            endExclusive: job.offset + rightRange[1],
          },
          leftCounts: counts(leftRange),
          rightCounts: counts(rightRange),
        };
      }
      const [start, end] = centeredRange(
        index,
        parameters.window,
        bytes.length,
      );
      const bias = value[0] ? value[parameters.bit + 1] / value[0] : 0;
      return {
        ...result,
        valid: value[0] > 0,
        sourceRange: {
          start: job.offset + start,
          endExclusive: job.offset + end,
        },
        sampleCount: value[0],
        ones: value[parameters.bit + 1],
        zeroes: value[0] - value[parameters.bit + 1],
        bias,
        entropyBits: binaryEntropy(bias),
      };
    },
  };
  return provider;
}
