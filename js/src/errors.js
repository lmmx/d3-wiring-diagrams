/**
 * The single error type thrown by this package. `kind` is one of the names
 * shared with the Python and Rust implementations (docs/format.md).
 */
export class WiringError extends Error {
  /**
   * @param {string} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(`${kind}: ${message}`);
    this.name = "WiringError";
    this.kind = kind;
  }
}
