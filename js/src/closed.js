/**
 * The closed structure of the operad (Spivak, Definition 5.1.1, Proposition 5.1.4).
 *
 * `[Y₁, …, Yₙ ⇒ Z]` is the coproduct `Y₁ ⊔ … ⊔ Yₙ ⊔ Z`. Wire `a` of `Yᵢ` is named
 * `"{i}.{a}"` and wire `b` of `Z` is named `"out.{b}"`. The text before the first
 * `.` is a decimal index or `out`, which makes the encoding injective.
 */

import { WiringDiagram } from "./diagram.js";
import { WiringError } from "./errors.js";
import { Star } from "./star.js";

/** Name in `[Y ⇒ Z]` of wire `name` of `Yᵢ`, or of `Z` when `i` is `null`. */
export function homWire(/** @type {number | null} */ i, /** @type {string} */ name) {
  return i === null ? `out.${name}` : `${i}.${name}`;
}

/** `[Y₁, …, Yₙ ⇒ Z] = Y₁ ⊔ … ⊔ Yₙ ⊔ Z`. */
export function internalHom(/** @type {readonly Star[]} */ ys, /** @type {Star} */ z) {
  /** @type {[string, string][]} */
  const pairs = [];
  ys.forEach((y, i) => {
    for (const [a, t] of y) pairs.push([homWire(i, a), t]);
  });
  for (const [b, t] of z) pairs.push([homWire(null, b), t]);
  return new Star(pairs);
}

/** `ev: [Y ⇒ Z], Y₁, …, Yₙ → Z`. */
export function evaluation(/** @type {readonly Star[]} */ ys, /** @type {Star} */ z) {
  const hom = internalHom(ys, z);
  const inner = [Object.fromEntries(hom.names.map((n, c) => [n, c]))];
  ys.forEach((y, i) => inner.push(Object.fromEntries(y.names.map((a) => [a, hom.indexOf(homWire(i, a))]))));
  const outer = Object.fromEntries(z.names.map((b) => [b, hom.indexOf(homWire(null, b))]));
  return new WiringDiagram(hom.types, inner, outer);
}

/**
 * `extl: O(X; [Y ⇒ Z]) → O(X, Y; Z)`. Equal to
 * `evaluation(ys, z).compose([phi, id_Y₁, …])`, computed directly.
 */
export function externalize(
  /** @type {WiringDiagram} */ phi,
  /** @type {readonly Star[]} */ ys,
  /** @type {Star} */ z,
) {
  const hom = internalHom(ys, z);
  if (!phi.outer.equals(hom)) {
    throw new WiringError("hom_mismatch", `outer star ${phi.outer} is not [Y ⇒ Z] = ${hom}`);
  }
  const g = phi.outerWiring();
  const inner = phi.inner.map((_, i) => phi.innerWiring(i));
  ys.forEach((y, i) => inner.push(Object.fromEntries(y.names.map((a) => [a, g[homWire(i, a)]]))));
  const outer = Object.fromEntries(z.names.map((b) => [b, g[homWire(null, b)]]));
  return new WiringDiagram(phi.cables, inner, outer);
}

/** `intl: O(X₁..Xₘ, Y₁..Yₙ; Z) → O(X₁..Xₘ; [Y ⇒ Z])`, the inverse of `externalize`. */
export function internalize(/** @type {WiringDiagram} */ psi, /** @type {number} */ m) {
  if (!(Number.isInteger(m) && m >= 0 && m <= psi.arity)) {
    throw new WiringError("split_out_of_range", `cannot split ${psi.arity} inner stars at ${m}`);
  }
  const inner = psi.inner.slice(0, m).map((_, i) => psi.innerWiring(i));
  /** @type {[string, number][]} */
  const outer = [];
  for (let i = m; i < psi.arity; i++) {
    for (const [a, c] of Object.entries(psi.innerWiring(i))) outer.push([homWire(i - m, a), c]);
  }
  for (const [b, c] of Object.entries(psi.outerWiring())) outer.push([homWire(null, b), c]);
  return new WiringDiagram(psi.cables, inner, outer);
}
