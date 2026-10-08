/**
 * Compare strings by Unicode code point, the order used by Python's `sorted`
 * and Rust's `str::cmp`.
 *
 * Plain `<` compares UTF-16 code units. That puts astral characters (U+10000
 * and up, stored as surrogates D800–DFFF) *before* U+E000–U+FFFF. To fix it,
 * remap the differing code unit so that surrogates sort above every other BMP
 * unit.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive
 */
export function compareCodePoints(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return fixup(x) - fixup(y);
  }
  return a.length - b.length;
}

/** @param {number} unit */
function fixup(unit) {
  if (unit >= 0xe000) return unit - 0x800; // E000–FFFF -> D800–F7FF
  if (unit >= 0xd800) return unit + 0x2000; // D800–DFFF -> F800–FFFF
  return unit;
}
