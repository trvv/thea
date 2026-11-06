/** Single-byte glyph decoding for point text overlays. */
// CP437 high-byte glyphs; control pictures remain consistent across encodings.
const cp437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0";

/**
 * Distinguish invisible control bytes without interpreting a multibyte text stream. Blank NUL/SP
 * toggles are independent, and higher-byte glyphs depend on the chosen single-byte encoding.
 */
export function byteCharacter(
  byte,
  encoding,
  blankSpaces = false,
  blankNulls = true,
) {
  if (encoding === "ascii-overbar" && byte >= 128) {
    return (
      byteCharacter(byte & 0x7f, "ascii", blankSpaces, blankNulls) + "\u0305"
    );
  }
  if ((byte === 0 && blankNulls) || (byte === 32 && blankSpaces)) return " ";
  if (byte <= 32) return String.fromCharCode(0x2400 + byte);
  if (byte === 127) return "\u2421";
  if (byte < 127) return String.fromCharCode(byte);
  if (encoding === "cp437") return cp437[byte - 128];
  if (encoding === "latin1" && byte >= 160) return String.fromCharCode(byte);
  return "·";
}
