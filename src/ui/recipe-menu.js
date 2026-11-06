/**
 * Pure menu descriptors edit recipe data. Keeping DOM and compilation out of this layer lets edits
 * use the same validation as programmatic assignments.
 * @module recipe-menu
 */
import { factorOptions } from "../recipes/factor-catalog.js";
import {
  numericFormats,
  numericKinds,
  integer64Format,
  floatingFormat,
} from "../analysis/numeric-interpretation.js";
import {
  analysisKinds,
  analysisParameters,
} from "../analysis/analysis-parameters.js";
import {
  constant,
  reference,
  hilbertCoordinate,
  hCurveCoordinate,
  hilbert3DCoordinate,
  mortonCoordinate,
  recipeLabel,
} from "../recipes/recipes.js";

// Menu descriptors edit the same serializable expressions consumed by both backends.
/**
 * Build immutable-expression edits from menu descriptors rather than capturing renderer internals.
 * Numeric operands and nested inputs use the same validator as assignments from JavaScript.
 */
export function recipeMenu(label, value, definitions, change, save, depth = 0) {
  const expression = value === "none" ? "value" : value;
  const set = (next) => change(structuredClone(next));
  const parameter = (label, key, min = -1e6, max = 1e6, step = "any") => ({
    label,
    input: "number",
    value: expression[key],
    min,
    max,
    step,
    action: (number) => set({ ...expression, [key]: number }),
  });
  const input = (label, key) =>
    recipeMenu(
      label,
      expression[key],
      definitions,
      (next) =>
        set({ ...expression, [key]: next === "none" ? constant(0) : next }),
      save,
      depth + 1,
    );
  const choose = (label, current, options, action) => ({
    label,
    value: current,
    options,
    action,
  });
  const axes = [
    { value: 0, label: "X" },
    { value: 1, label: "Y" },
    { value: 2, label: "Z" },
  ];
  const componentOptions = axes.slice(
    0,
    expression?.input?.op === "hilbert3d" ||
      (expression?.input?.op === "morton" && expression.input.dimensions === 3)
      ? 3
      : 2,
  );
  const sourceName =
    typeof value === "string"
      ? value
      : value?.op === "factor"
        ? value.name
        : undefined;
  const sources = [
    ...factorOptions.map((option) => ({
      label: option.label,
      checked: sourceName === option.value,
      action: () => set(option.value),
    })),
    ...(Object.keys(definitions).length
      ? [
          {
            label: "Saved Factors",
            items: Object.keys(definitions).map((name) => ({
              label: name,
              checked: value?.op === "ref" && value.name === name,
              action: () => set(reference(name)),
            })),
          },
        ]
      : []),
    {
      label: "Offset",
      checked: value?.op === "offset",
      action: () => set({ op: "offset" }),
    },
    {
      label: "Length",
      checked: value?.op === "length",
      action: () => set({ op: "length" }),
    },
    {
      label: "Point Index",
      checked: value?.op === "pointIndex",
      action: () => set({ op: "pointIndex" }),
    },
    {
      label: "Point Count",
      checked: value?.op === "pointCount",
      action: () => set({ op: "pointCount" }),
    },
    {
      label: "Constant",
      checked: value?.op === "constant",
      action: () => set(constant(0.5)),
    },
  ];
  const transformations = [
    ...["invert", "abs", "floor", "fract"].map((op) => ({
      label: {
        invert: "Invert",
        abs: "Absolute",
        floor: "Floor",
        fract: "Fraction",
      }[op],
      action: () => set({ op, input: expression }),
    })),
    ...["add", "subtract", "multiply", "divide"].map((op) => ({
      label: {
        add: "Add",
        subtract: "Subtract",
        multiply: "Multiply",
        divide: "Divide",
      }[op],
      action: () =>
        set({
          op,
          a: expression,
          b: constant(["multiply", "divide"].includes(op) ? 1 : 0),
        }),
    })),
    {
      label: "Bit",
      action: () => set({ op: "bit", input: expression, bit: 0 }),
    },
    {
      label: "Population Count",
      action: () => set({ op: "popcount", input: expression }),
    },
    {
      label: "Byte XOR",
      action: () => set({ op: "xor", a: expression, b: constant(0) }),
    },
    {
      label: "Power",
      action: () => set({ op: "power", input: expression, exponent: 1 }),
    },
    {
      label: "Normalize",
      action: () =>
        set({ op: "normalize", input: expression, min: 0, max: 255 }),
    },
    {
      label: "Clamp",
      action: () => set({ op: "clamp", input: expression, min: 0, max: 1 }),
    },
    {
      label: "Read Byte",
      action: () => set({ op: "byte", offset: expression }),
    },
    {
      label: "Available Span",
      action: () => set({ op: "available", offset: expression, width: 1 }),
    },
    {
      label: "Read Number",
      items: Object.keys(numericFormats).map((format) => ({
        label: format,
        action: () =>
          set({
            op: "number",
            offset: expression,
            format,
            endian: "little",
            kind: "normalized",
            ...(floatingFormat(format) ? { min: 0, max: 1 } : {}),
          }),
      })),
    },
    {
      label: "Statistical Analysis",
      items: Object.keys(analysisKinds).map((family) => ({
        label: {
          conditional: "Conditional Probability",
          lag: "Lag Comparison",
          distribution: "Distribution Change",
          bit: "Bit Statistics",
          repetition: "Repetition Distance",
          spectral: "Local Spectral Energy",
          occurrence: "Occurrence Statistics",
          reduction: "Occurrence Mean Entropy",
          reference: "Reference Resemblance",
          encoding: "Text Interpretation",
          reference: "Reference Resemblance",
        }[family],
        action: () =>
          set({
            op: "analysis",
            offset: expression,
            ...analysisParameters({ family }),
          }),
      })),
    },
    {
      label: "Local Entropy",
      action: () => set({ op: "entropy", offset: expression, window: 32 }),
    },
    ...["phase", "frequency", "amplitude"].map((kind) => ({
      label: `DFT ${kind[0].toUpperCase() + kind.slice(1)}`,
      action: () => set({ op: "spectrum", kind, input: expression }),
    })),
    ...axes.slice(0, 2).map(({ value: component, label }) => ({
      label: `Hilbert ${label}`,
      action: () => set(hilbertCoordinate(component, expression)),
    })),
    {
      label: "H-Curve",
      items: axes.slice(0, 2).map(({ value: component, label }) => ({
        label,
        action: () => set(hCurveCoordinate(component, expression)),
      })),
    },
    {
      label: "Hilbert 3D",
      items: axes.map(({ value: component, label }) => ({
        label,
        action: () => set(hilbert3DCoordinate(component, expression)),
      })),
    },
    ...[2, 3].map((dimensions) => ({
      label: `Morton ${dimensions}D`,
      items: axes.slice(0, dimensions).map(({ value: component, label }) => ({
        label,
        action: () =>
          set(mortonCoordinate(component, expression, 0, dimensions)),
      })),
    })),
    ...axes.slice(0, 2).map(({ value: component, label }) => ({
      label: `Linear ${label}`,
      action: () =>
        set({
          op: "component",
          component,
          input: { op: "linear", input: expression },
        }),
    })),
  ];
  const parameters = [];
  // The shorthand is the same 32-byte source as the explicit entropy recipe. Editing its window
  // expands it to ordinary recipe data, so dependency planning and profiles need no special state.
  if (sourceName === "entropy")
    parameters.push({
      label: "Window",
      input: "number",
      value: 32,
      min: 1,
      max: 4096,
      step: 1,
      action: (window) =>
        set({ op: "entropy", offset: { op: "offset" }, window }),
    });
  if (expression && typeof expression === "object" && depth < 32) {
    if (expression.op === "constant")
      parameters.push(parameter("Value", "value"));
    if (expression.a !== undefined)
      parameters.push(input("Input", "a"), input("Operand", "b"));
    if (expression.offset !== undefined)
      parameters.push(input("Offset", "offset"));
    if (expression.op === "component") {
      parameters.push(
        choose(
          "Component",
          expression.component,
          componentOptions,
          (component) => set({ ...expression, component }),
        ),
      );
      if (
        ["hilbert", "hilbert3d", "morton", "hcurve"].includes(
          expression.input.op,
        )
      )
        parameters.push({
          label: "Order",
          input: "number",
          value: expression.input.order ?? 0,
          min: 0,
          max:
            expression.input.op === "hilbert3d" ||
            (expression.input.op === "morton" &&
              expression.input.dimensions === 3)
              ? 10
              : 15,
          step: 1,
          action: (order) =>
            set({ ...expression, input: { ...expression.input, order } }),
        });
      if (
        ["hilbert", "hilbert3d", "linear", "morton", "hcurve"].includes(
          expression.input.op,
        )
      )
        parameters.push(
          recipeMenu(
            "Input",
            expression.input.input,
            definitions,
            (next) =>
              set({
                ...expression,
                input: {
                  ...expression.input,
                  input: next === "none" ? constant(0) : next,
                },
              }),
            save,
            depth + 1,
          ),
        );
    } else if (expression.input !== undefined)
      parameters.push(input("Input", "input"));
    if (expression.op === "entropy")
      parameters.push(parameter("Window", "window", 1, 4096, 1));
    if (expression.op === "available")
      parameters.push(parameter("Width", "width", 1, 8, 1));
    if (expression.op === "analysis") {
      const canonical = analysisParameters(expression);
      const labels = {
        probability: "Probability",
        surprise: "Surprise",
        valid: "Valid",
        equality: "Equality",
        difference: "Mean Absolute Difference",
        information: "Mutual Information",
        pairs: "Valid Pairs",
        variation: "Total Variation",
        divergence: "Jensen–Shannon Divergence",
        bias: "Bit Bias",
        entropy: "Bit Entropy",
        count: canonical.family === "bit" ? "Set Bit Count" : "Count",
        distance: "Distance",
        length: "Match Length",
        energy: "Band Energy",
        power: "Band Power",
        totalPower: "Total Power",
        exposure: "Exposure",
        mean: "Mean Entropy",
        sum: "Entropy Sum",
        coverage: "Coverage",
        codePoint: "Code Point",
        byteIndex: "Byte Index",
      };
      parameters.push(
        choose(
          "Projection",
          canonical.kind,
          analysisKinds[canonical.family].map((value) => ({
            value,
            label: labels[value],
          })),
          (kind) => set({ ...expression, kind }),
        ),
      );
      if (canonical.family === "reference")
        parameters.push({
          label: "Model ID",
          input: "text",
          value: canonical.modelID,
          action: (modelID) => set({ ...expression, modelID }),
        });
      if (canonical.family === "encoding")
        parameters.push(
          choose(
            "Encoding",
            canonical.encoding,
            ["utf8", "utf16le", "utf16be", "utf32le", "utf32be"].map(
              (value) => ({ value, label: value.toUpperCase() }),
            ),
            (encoding) => set({ ...expression, encoding }),
          ),
        );
      for (const [key, label, min, max, step] of [
        ["alpha", "Smoothing", Number.MIN_VALUE, 1000000, "any"],
        ["window", "Window", canonical.family === "lag" ? 0 : 1, 4096, 1],
        ["lag", "Lag", 1, 1000000, 1],
        ["gap", "Gap", 0, 1000000, 1],
        ["bit", "Bit", 0, 7, 1],
        ["history", "History", 1, 1000000, 1],
        ["maxLength", "Maximum Match Length", 4, 4096, 1],
        ["hop", "Hop", 1, 1000000, 1],
        ["origin", "Origin", 0, 1000000, 1],
        ["low", "Band Minimum", 0, canonical.high ?? 0.5, "any"],
        ["high", "Band Maximum", canonical.low ?? 0, 0.5, "any"],
        [
          "width",
          "Tuple Width",
          canonical.family === "reduction" ? 2 : 1,
          3,
          1,
        ],
        [
          "referenceValue",
          "Reference Count",
          Number.MIN_VALUE,
          Number.MAX_SAFE_INTEGER,
          "any",
        ],
        ["percentile", "Percentile", 0, 1, "any"],
        ["compression", "Compression", Number.MIN_VALUE, 1000000, "any"],
        ["exposure", "Exposure", Number.MIN_VALUE, 1000000, "any"],
      ])
        if (canonical[key] !== undefined)
          parameters.push({
            ...parameter(label, key, min, max, step),
            value: canonical[key],
          });
      for (const [key, label, values] of [
        ["taper", "Taper", ["rectangular", "hann"]],
        ["preprocessing", "Preprocessing", ["unsigned", "centered", "mean"]],
        ["edge", "Edges", ["omit", "zero"]],
        ["reference", "Reference", ["fixed", "percentile"]],
      ])
        if (canonical[key] !== undefined)
          parameters.push(
            choose(
              label,
              canonical[key],
              values.map((value) => ({ value, label: value })),
              (value) => set({ ...expression, [key]: value }),
            ),
          );
      for (const [key, label] of [
        ["overlap", "Overlap"],
        ["dc", "Include DC"],
        ["includeZero", "Include Zero Counts"],
      ])
        if (canonical[key] !== undefined)
          parameters.push({
            label,
            checked: canonical[key],
            action: () => set({ ...expression, [key]: !canonical[key] }),
          });
    }
    if (expression.op === "number") {
      const format = expression.format ?? "uint16";
      const kind = expression.kind ?? "normalized";
      parameters.push(
        choose(
          "Format",
          format,
          Object.keys(numericFormats).map((value) => ({ value, label: value })),
          (format) =>
            set({
              ...expression,
              format,
              kind:
                ["exponent", "fraction"].includes(kind) &&
                !floatingFormat(format)
                  ? "normalized"
                  : kind,
              min: floatingFormat(format) ? 0 : undefined,
              max: floatingFormat(format) ? 1 : undefined,
            }),
        ),
        choose(
          "Byte Order",
          expression.endian ?? "little",
          [
            { value: "little", label: "Little Endian" },
            { value: "big", label: "Big Endian" },
          ],
          (endian) => set({ ...expression, endian }),
        ),
        choose(
          "Projection",
          kind,
          numericKinds
            .filter(
              (value) =>
                floatingFormat(format) ||
                !["exponent", "fraction"].includes(value),
            )
            .map((value) => ({ value, label: value })),
          (kind) =>
            set({
              ...expression,
              kind,
              ...(kind === "normalized" && floatingFormat(format)
                ? { min: expression.min ?? 0, max: expression.max ?? 1 }
                : {}),
            }),
        ),
      );
      if (kind === "normalized") {
        const min = expression.min ?? numericFormats[format].min;
        const max = expression.max ?? numericFormats[format].max;
        if (integer64Format(format)) {
          parameters.push(
            {
              label: "Minimum",
              input: "text",
              value: min,
              action: (value) => set({ ...expression, min: value }),
            },
            {
              label: "Maximum",
              input: "text",
              value: max,
              action: (value) => set({ ...expression, max: value }),
            },
          );
        } else
          parameters.push(
            {
              ...parameter("Minimum", "min", -Number.MAX_VALUE, max),
              value: min,
            },
            {
              ...parameter("Maximum", "max", min, Number.MAX_VALUE),
              value: max,
            },
          );
      }
    }
    if (expression.op === "spectrum")
      parameters.push(
        choose(
          "Interpolation",
          expression.interpolation ?? "nearest",
          [
            { value: "nearest", label: "Nearest" },
            { value: "complex", label: "Complex" },
          ],
          (interpolation) => set({ ...expression, interpolation }),
        ),
        choose(
          "Component",
          expression.kind,
          ["phase", "frequency", "amplitude"].map((value) => ({
            value,
            label: value,
          })),
          (kind) => set({ ...expression, kind }),
        ),
      );
    if (expression.op === "bit")
      parameters.push(parameter("Bit", "bit", 0, 7, 1));
    if (expression.op === "power")
      parameters.push(parameter("Exponent", "exponent", 0, 16));
    if (["normalize", "clamp"].includes(expression.op))
      parameters.push(
        parameter("Minimum", "min", -1e6, expression.max - 0.000001),
        parameter("Maximum", "max", expression.min + 0.000001, 1e6),
      );
  }
  const unwrapped =
    typeof expression === "object"
      ? (expression.a ??
        expression.offset ??
        (expression.op === "component"
          ? expression.input.input
          : expression.input))
      : undefined;
  return {
    label,
    detail: recipeLabel(value),
    action: set,
    items: [
      { label: "Source", items: sources },
      { label: "Transform", items: transformations },
      ...parameters,
      ...(unwrapped === undefined
        ? []
        : [{ label: "Remove Last Transform", action: () => set(unwrapped) }]),
      ...(save && value !== "none"
        ? [{ label: "Save Factor", action: () => save(value) }]
        : []),
    ],
  };
}
