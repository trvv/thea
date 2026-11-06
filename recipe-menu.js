/**
 * Pure menu descriptors edit recipe data. Keeping DOM and compilation out of this layer lets edits
 * use the same validation as programmatic assignments.
 * @module recipe-menu
 */
import { factorOptions } from "./factor-catalog.js";
import {
  constant,
  reference,
  hilbertCoordinate,
  hilbert3DCoordinate,
  recipeLabel,
} from "./recipes.js";

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
    expression?.input?.op === "hilbert3d" ? 3 : 2,
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
      label: "Hilbert 3D",
      items: axes.map(({ value: component, label }) => ({
        label,
        action: () => set(hilbert3DCoordinate(component, expression)),
      })),
    },
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
      if (["hilbert", "hilbert3d"].includes(expression.input.op))
        parameters.push({
          label: "Order",
          input: "number",
          value: expression.input.order ?? 0,
          min: 0,
          max: expression.input.op === "hilbert3d" ? 10 : 15,
          step: 1,
          action: (order) =>
            set({ ...expression, input: { ...expression.input, order } }),
        });
      if (["hilbert", "hilbert3d", "linear"].includes(expression.input.op))
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
    if (expression.op === "spectrum")
      parameters.push(
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
