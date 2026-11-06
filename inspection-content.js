/** Plain DOM inspection content. Provider data is rendered as text, never interpreted as HTML. */
import { recipeLabel } from "./recipes.js";
import { factorOptions } from "./factor-catalog.js";
const labels = new Map(factorOptions.map(({ value, label }) => [value, label]));
const title = (value) =>
  value === "utf8"
    ? "UTF-8"
    : value
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (letter) => letter.toUpperCase());
const format = (value) =>
  Array.isArray(value) ? value.map(format).join(", ") : String(value);
const controls = [
  "NUL",
  "SOH",
  "STX",
  "ETX",
  "EOT",
  "ENQ",
  "ACK",
  "BEL",
  "BS",
  "HT",
  "LF",
  "VT",
  "FF",
  "CR",
  "SO",
  "SI",
  "DLE",
  "DC1",
  "DC2",
  "DC3",
  "DC4",
  "NAK",
  "SYN",
  "ETB",
  "CAN",
  "EM",
  "SUB",
  "ESC",
  "FS",
  "GS",
  "RS",
  "US",
];
const byteText = (value) => {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    return format(value);
  const ascii =
    value < 32
      ? controls[value]
      : value === 127
        ? "DEL"
        : value < 127
          ? JSON.stringify(String.fromCharCode(value))
          : "non-ASCII";
  return `${value} (0x${value.toString(16).padStart(2, "0").toUpperCase()}, ${value > 127 ? "non-ASCII" : `ASCII ${ascii}`})`;
};
const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
function fields(data) {
  const table = element("table");
  for (const [name, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const row = element("tr"),
      key = element("th", title(name)),
      cell = element("td");
    key.scope = "row";
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const details = element("details");
      details.append(element("summary", title(name)), fields(value));
      cell.append(details);
    } else if (
      name === "byteValue" ||
      (name === "value" && data.sourceOffset !== undefined)
    )
      cell.textContent = byteText(value);
    else if ((name === "bytes" || name === "tuple") && Array.isArray(value))
      cell.textContent = value.map(byteText).join(", ");
    else cell.textContent = format(value);
    row.append(key, cell);
    table.append(row);
  }
  return table;
}
export function inspectionContent(info) {
  const body = element("div"),
    point = info.point;
  body.className = "point-inspection";
  // Light-DOM content belongs to the view's shadow tree; popup-shadow selectors cannot reach it.
  const style = element(
    "style",
    `
  .point-inspection table { border-collapse: collapse; }
  .point-inspection th { text-align: left; vertical-align: top; }
  .point-inspection th, .point-inspection td { padding: 2px 4px; }
  .point-inspection td { overflow-wrap: anywhere; }
  .point-inspection summary { cursor: pointer; }
 `,
  );
  body.append(style);
  const heading =
    point.population === "bytes"
      ? point.sampleRange
        ? `Bytes [${point.sampleRange.start}, ${point.sampleRange.endExclusive})`
        : `Byte 0x${point.byteValue.toString(16).padStart(2, "0").toUpperCase()} @ 0x${point.sourceOffset.toString(16)}`
      : point.population === "bins"
        ? `Bin ${point.bin.bin} / ${point.bin.binCount}`
        : `${point.population === "pairs" ? "Pair" : "Triple"} [${point.tuple.join(", ")}] @ 0x${point.sourceOffset.toString(16)}`;
  const origin = element("details");
  origin.append(element("summary", "Point"), fields(point));
  body.append(element("strong", heading), origin);
  const nodeContent = (id, seen) => {
    const node = info.nodes[id],
      details = element("details");
    const description = `${node.op === "factor" ? labels.get(node.name) || node.name : title(node.op)} = ${format(node.value)}`;
    if (seen.has(id)) return element("div", description);
    seen.add(id);
    details.append(element("summary", description));
    const {
      id: ignoredId,
      args,
      type,
      op,
      name,
      value,
      source,
      ...parameters
    } = node;
    if (Object.keys(parameters).length) details.append(fields(parameters));
    if (source) details.append(fields(source));
    for (const input of args) details.append(nodeContent(input, seen));
    return details;
  };
  for (const trait of info.traits) {
    const details = element("details");
    const expression =
      labels.get(trait.expression) || recipeLabel(trait.expression);
    details.append(
      element(
        "summary",
        `${trait.name}: ${expression} = ${format(trait.value ?? trait.rendered)}`,
      ),
    );
    if (trait.root !== undefined)
      details.append(nodeContent(trait.root, new Set()));
    if (trait.mapping) details.append(fields(trait.mapping));
    if (trait.rendered !== undefined)
      details.append(fields({ rendered: trait.rendered }));
    body.append(details);
  }
  const rendering = element("details");
  rendering.append(element("summary", "Rendering"), fields(info.rendering));
  body.append(rendering);
  return body;
}
