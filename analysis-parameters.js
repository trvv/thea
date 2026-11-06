/** Serializable statistical definitions; preparation and rendering do not own their meaning. */
export const analysisKinds = {
  conditional: ["probability", "surprise", "valid"],
  lag: ["equality", "difference", "information", "pairs", "valid"],
  distribution: ["variation", "divergence", "valid"],
  bit: ["bias", "entropy", "count", "valid"],
  repetition: ["distance", "length", "valid"],
  spectral: ["energy", "valid", "power", "totalPower"],
  occurrence: ["count", "probability", "exposure", "valid"],
  reduction: ["mean", "sum", "count", "valid"],
  reference: ["surprise", "coverage", "valid"],
  encoding: ["codePoint", "length", "byteIndex", "valid"],
};

const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
};

export function analysisParameters(expression) {
  const family = expression.family ?? "conditional";
  if (!Object.hasOwn(analysisKinds, family))
    throw new TypeError("Unknown statistical analysis family");
  const kind = expression.kind ?? analysisKinds[family][0];
  if (!analysisKinds[family].includes(kind))
    throw new TypeError("Unknown statistical analysis projection");
  const scope = expression.scope ?? "selection";
  if (scope !== "selection")
    throw new TypeError(
      "Statistical analysis currently requires selection scope",
    );
  const parameters = { family, kind, scope };
  if (family === "encoding") {
    parameters.encoding = expression.encoding ?? "utf8";
    if (
      !["utf8", "utf16le", "utf16be", "utf32le", "utf32be"].includes(
        parameters.encoding,
      )
    )
      throw new TypeError("Unknown encoding interpretation");
    parameters.origin = integer(
      expression.origin ?? 0,
      0,
      1000000,
      "Alignment origin",
    );
  } else if (family === "reference") {
    parameters.modelID = expression.modelID ?? "reference:unselected";
    if (
      typeof parameters.modelID !== "string" ||
      !/^reference:[A-Za-z0-9_-]{1,100}$/.test(parameters.modelID)
    )
      throw new TypeError("Invalid reference model ID");
    parameters.window = integer(
      expression.window ?? 32,
      1,
      4096,
      "Reference window",
    );
  } else if (family === "conditional") {
    const alpha = expression.alpha ?? 1 / 256;
    if (
      typeof alpha !== "number" ||
      !Number.isFinite(alpha) ||
      alpha <= 0 ||
      alpha > 1000000
    )
      throw new TypeError(
        "Smoothing must be finite, positive, and at most 1000000",
      );
    parameters.alpha = alpha;
  } else if (family === "reduction") {
    parameters.measure = expression.measure ?? "entropy";
    if (parameters.measure !== "entropy")
      throw new TypeError("Unknown occurrence reduction measurement");
    parameters.width = integer(expression.width ?? 2, 2, 3, "Tuple width");
    parameters.window = integer(
      expression.window ?? 32,
      1,
      4096,
      "Entropy window",
    );
  } else if (family === "occurrence") {
    parameters.width = integer(expression.width ?? 1, 1, 3, "Tuple width");
    parameters.reference = expression.reference ?? "percentile";
    if (!["fixed", "percentile"].includes(parameters.reference))
      throw new TypeError("Unknown count reference policy");
    parameters.referenceValue = expression.referenceValue ?? 1;
    if (
      !Number.isFinite(parameters.referenceValue) ||
      parameters.referenceValue <= 0 ||
      parameters.referenceValue > Number.MAX_SAFE_INTEGER
    )
      throw new TypeError(
        "Count reference must be positive and at most the safe integer limit",
      );
    parameters.percentile = expression.percentile ?? 0.99;
    if (
      !Number.isFinite(parameters.percentile) ||
      parameters.percentile < 0 ||
      parameters.percentile > 1
    )
      throw new TypeError("Count percentile must be between zero and one");
    parameters.includeZero = expression.includeZero ?? false;
    if (typeof parameters.includeZero !== "boolean")
      throw new TypeError("Zero-count inclusion must be boolean");
    for (const name of ["compression", "exposure"]) {
      parameters[name] = expression[name] ?? 1;
      if (
        !Number.isFinite(parameters[name]) ||
        parameters[name] <= 0 ||
        parameters[name] > 1000000
      )
        throw new TypeError(
          `${name} must be finite, positive and at most 1000000`,
        );
    }
  } else if (family === "repetition") {
    parameters.history = integer(
      expression.history ?? 65536,
      1,
      1000000,
      "History",
    );
    parameters.maxLength = integer(
      expression.maxLength ?? 4,
      4,
      4096,
      "Maximum match length",
    );
    parameters.overlap = expression.overlap ?? true;
    if (typeof parameters.overlap !== "boolean")
      throw new TypeError("Overlap must be boolean");
  } else if (family === "spectral") {
    parameters.window = integer(
      expression.window ?? 256,
      1,
      4096,
      "Frame length",
    );
    parameters.hop = integer(
      expression.hop ?? Math.max(1, Math.floor(parameters.window / 2)),
      1,
      1000000,
      "Frame hop",
    );
    parameters.origin = integer(
      expression.origin ?? 0,
      0,
      1000000,
      "Frame origin",
    );
    parameters.taper = expression.taper ?? "rectangular";
    parameters.preprocessing = expression.preprocessing ?? "mean";
    parameters.edge = expression.edge ?? "omit";
    parameters.dc = expression.dc ?? false;
    if (!["rectangular", "hann"].includes(parameters.taper))
      throw new TypeError("Unknown spectral taper");
    if (!["unsigned", "centered", "mean"].includes(parameters.preprocessing))
      throw new TypeError("Unknown spectral preprocessing");
    if (!["omit", "zero"].includes(parameters.edge))
      throw new TypeError("Unknown spectral edge policy");
    if (typeof parameters.dc !== "boolean")
      throw new TypeError("DC inclusion must be boolean");
    parameters.low = expression.low ?? 0;
    parameters.high = expression.high ?? 0.5;
    if (
      !Number.isFinite(parameters.low) ||
      !Number.isFinite(parameters.high) ||
      parameters.low < 0 ||
      parameters.high > 0.5 ||
      parameters.low > parameters.high
    )
      throw new TypeError(
        "Frequency band must be ordered within zero to 0.5 cycles per byte",
      );
  } else {
    parameters.window = integer(
      expression.window ?? 32,
      family === "lag" ? 0 : 1,
      4096,
      "Window",
    );
    if (family === "lag")
      parameters.lag = integer(expression.lag ?? 1, 1, 1000000, "Lag");
    if (family === "distribution")
      parameters.gap = integer(expression.gap ?? 0, 0, 1000000, "Gap");
    if (family === "bit")
      parameters.bit = integer(expression.bit ?? 0, 0, 7, "Bit");
  }
  return parameters;
}

/** Outputs and bit projections share prepared windows; smoothing shares conditional raw counts. */
export function analysisModelKey(parameters) {
  const model = { family: parameters.family, scope: parameters.scope };
  if (!["conditional", "repetition", "occurrence"].includes(parameters.family))
    model.window = parameters.window;
  if (parameters.family === "lag") model.lag = parameters.lag;
  if (parameters.family === "distribution") model.gap = parameters.gap;
  if (parameters.family === "occurrence") model.width = parameters.width;
  if (parameters.family === "reduction") {
    model.width = parameters.width;
    model.measure = parameters.measure;
  }
  if (parameters.family === "repetition")
    for (const name of ["history", "maxLength", "overlap"])
      model[name] = parameters[name];
  if (parameters.family === "spectral")
    for (const name of [
      "hop",
      "origin",
      "taper",
      "preprocessing",
      "edge",
      "dc",
      "low",
      "high",
    ])
      model[name] = parameters[name];
  return JSON.stringify(model);
}
