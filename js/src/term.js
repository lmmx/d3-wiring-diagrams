/**
 * Operad terms: trees of wiring diagrams ("a wiring diagram of wiring diagrams").
 * Labels are presentation only and never affect equality of morphisms.
 */

import { WiringDiagram } from "./diagram.js";
import { WiringError } from "./errors.js";
import { isPlainObject } from "./star.js";

export class Term {
  /**
   * @param {WiringDiagram} diagram
   * @param {readonly (Term | null)[]} [children] one per inner star; `null` leaves it open
   * @param {readonly (string | null)[]} [labels] labels of the inner stars
   * @param {string | null} [label] label of the outer star
   */
  constructor(diagram, children, labels, label = null) {
    const n = diagram.arity;
    const kids = children ?? Array(n).fill(null);
    const names = labels ?? Array(n).fill(null);
    if (kids.length !== n || names.length !== n) {
      throw new WiringError(
        "arity_mismatch",
        `term over a diagram of arity ${n} has ${kids.length} children and ${names.length} labels`,
      );
    }
    kids.forEach((kid, i) => {
      if (kid !== null && !kid.diagram.outer.equals(diagram.inner[i])) {
        throw new WiringError(
          "star_mismatch",
          `child ${i} has outer star ${kid.diagram.outer}, expected ${diagram.inner[i]}`,
        );
      }
    });
    this.diagram = diagram;
    this.children = Object.freeze([...kids]);
    this.labels = Object.freeze([...names]);
    this.label = label;
    Object.freeze(this);
  }

  /** Compose the tree bottom-up; open slots are filled with identities. */
  evaluate() {
    if (this.children.every((k) => k === null)) return this.diagram;
    return this.diagram.compose(
      this.children.map((kid, i) => (kid === null ? WiringDiagram.identity(this.diagram.inner[i]) : kid.evaluate())),
    );
  }

  /** Labels of the inner stars of `evaluate()`, in order. @returns {(string | null)[]} */
  leafLabels() {
    return this.children.flatMap((kid, i) => (kid === null ? [this.labels[i]] : kid.leafLabels()));
  }

  toJSON() {
    /** @type {Record<string, unknown>} */
    const data = { diagram: this.diagram.toJSON() };
    if (this.children.some((k) => k !== null)) data.children = this.children.map((k) => k?.toJSON() ?? null);
    if (this.labels.some((l) => l !== null)) data.labels = [...this.labels];
    if (this.label !== null) data.label = this.label;
    return data;
  }

  /** Parse `{diagram, children?, labels?, label?}`. @returns {Term} */
  static fromJSON(/** @type {unknown} */ data) {
    if (!isPlainObject(data) || !("diagram" in data)) {
      throw new WiringError("invalid_json", "a term is {diagram, children?, labels?, label?}");
    }
    const { diagram, children, labels, label } = /** @type {any} */ (data);
    return new Term(
      WiringDiagram.fromJSON(diagram),
      children?.map((/** @type {unknown} */ k) => (k === null ? null : Term.fromJSON(k))),
      labels,
      label ?? null,
    );
  }
}
