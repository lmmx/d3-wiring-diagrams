/**
 * The operad of wiring diagrams (Spivak, arXiv:1305.0297).
 *
 * - `Star`: objects (typed stars)
 * - `WiringDiagram`: morphisms (typed cospans up to isomorphism), with
 *   `identity`, `compose`, `composeAt`, `permute`, `mapTypes`
 * - closed structure: `internalHom`, `evaluation`, `externalize`, `internalize`
 * - `rel`: the relational algebra, including recursion; `eq`: equivalence relations
 * - `Term`: trees of diagrams, with presentation labels
 *
 * Layout and rendering live in `./layout.js` and `./render.js`.
 */

export { WiringError } from "./errors.js";
export { compareCodePoints } from "./order.js";
export { Star } from "./star.js";
export { WiringDiagram } from "./diagram.js";
export { Term } from "./term.js";
export { evaluation, externalize, homWire, internalHom, internalize } from "./closed.js";
export * as rel from "./rel.js";
export * as eq from "./eq.js";
