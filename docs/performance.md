# Performance

## Complexity

N is the total number of wires and cables involved.

| Operation | Cost |
| --- | --- |
| construction / canonical form | O(N + F log F), F = floating cables (sorted by type); wire sort O(k log k) per star |
| equality, hashing | O(N) on the canonical form |
| `compose(φ, ψ₁…ψₙ)` | O(N α(N)) union–find over `C ⊔ C₁ ⊔ … ⊔ Cₙ`, then relabel |
| `compose_at(i, ψ)` | O(\|φ\| + \|ψ\|): the other inner stars are carried over, not composed with identities |
| `permute`, `map_types`, `externalize`, `internalize` | O(N) |
| `rel.apply` | greedy hash joins with early projection; worst case exponential in arity (conjunctive query evaluation is NP-hard in the query), linear in data per join step |
| `eq.apply` | O(N α(N)) |
| `layout` (JS) | O(n² · 240), n = inner stars |

## Measurements

Same workloads in each language: `rust/benches/operad.rs` (criterion),
`python/benchmarks/bench.py` and `js/bench/bench.js` (medians). `just bench`
runs all three. The numbers below are from one run on a 4-vCPU Intel Xeon
@ 2.8 GHz cloud VM, a noisy machine. Read them as orders of magnitude.

- `ring_of_chains/n`: an outer diagram of `n` stars in a ring, each filled with
  a chain of 8 stars. The composite has `8n` stars and `27n` wires.
- `compose_at`: substitute one chain into a 10 000-star ring.
- `from_json` includes parsing the JSON text.
- `rel/path`: a path query of `m` binary relations "x → x+1 mod d", keeping
  the two ends.

| Benchmark | Rust 1.97 (release) | Node 22 | CPython 3.13 |
| --- | ---: | ---: | ---: |
| compose/ring_of_chains/100 | 0.062 ms | 1.4 ms | 2.8 ms |
| compose/ring_of_chains/1000 | 0.65 ms | 9.0 ms | 21 ms |
| compose/ring_of_chains/10000 | 13.5 ms | 76 ms | 240 ms |
| compose/compose_at/10000 | 1.1 ms | 11.6 ms | 21 ms |
| canonical/from_json/1000 | 2.0 ms | 3.0 ms | 4.6 ms |
| canonical/from_json/10000 | 24 ms | 43 ms | 53 ms |
| canonical/permute/1000 | 0.076 ms | 0.85 ms | 1.0 ms |
| canonical/permute/10000 | 1.0 ms | 6.3 ms | 13 ms |
| rel/path/m=8/d=64 | 0.25 ms | 1.2 ms | 1.2 ms |
| rel/path/m=32/d=64 | 1.05 ms | 4.4 ms | 5.4 ms |
| rel/path/m=8/d=512 | 1.75 ms | 8.0 ms | 12 ms |

Changes made because of these measurements (see the journal):

- `compose_at` used to build `n − 1` identity diagrams (Rust: 5.4 → 1.1 ms).
- The Rust JSON path parsed through a `serde_json::Value` DOM. It also
  allocated an error-context string per star, and it now interns repeated
  type and wire names (38 → 24 ms).
- The Rust hash join allocated a key and a tail per probe (rel/path
  440 → 250 µs).
- `Math.hypot` in the layout's inner loops (layout at 100 stars:
  240 → 44 ms).

Rust `from_json` is dominated by allocation: one `String` per wire name from
serde, before interning. A borrowed (`Cow<str>`) deserializer would remove it
and is the next step if JSON loading ever matters.
