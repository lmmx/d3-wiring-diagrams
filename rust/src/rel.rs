//! The relational algebra Rel (Spivak, Example 2.2.10, Lemma 4.1.2, §4.3, §5.2).
//!
//! `Rel(X)` is the set of relations `R ⊆ ∏_{x ∈ X} τ(x)`. Given
//! `φ = (⊔Xᵢ →f C ←g Y)`, `Rel(φ)(R₁, …, Rₙ)` is the *φ-conjunction*: the set of
//! `c ∘ g` over all cable assignments `c` with `c ∘ f|Xᵢ ∈ Rᵢ` for every `i`. In
//! database terms it is a conjunctive query.
//!
//! The evaluation plan is the same in all three implementations:
//!
//! 1. Each `Rᵢ` becomes a table over the cables it touches. When two wires of
//!    `Xᵢ` share a cable, only the rows where they agree are kept.
//! 2. A cable of `g` that no inner wire touches ranges over its declared domain.
//!    A floating cable empties the result when its domain is empty.
//! 3. Tables are hash-joined greedily. The next table is the one sharing the
//!    most cables with the running result (ties go to the smaller table). After
//!    each join, cables that nothing downstream needs are projected away.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::hash::Hash;

use crate::closed::{evaluation, internal_hom};
use crate::diagram::{Cable, WiringDiagram};
use crate::error::{Error, ErrorKind, Result};
use crate::star::Star;

/// The finite set of values of each type that Rel may need to enumerate.
pub type Domains<V> = HashMap<String, Vec<V>>;

/// A finite relation on a star: a set of rows, one value per wire in canonical order.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Relation<V> {
    star: Star,
    rows: BTreeSet<Box<[V]>>,
}

impl<V: Clone + Ord + Hash> Relation<V> {
    /// A relation from rows in canonical wire order.
    ///
    /// # Errors
    /// [`ErrorKind::RelationArity`] if a row's length differs from the star's.
    pub fn new<R: Into<Box<[V]>>>(star: Star, rows: impl IntoIterator<Item = R>) -> Result<Self> {
        let rows: BTreeSet<Box<[V]>> = rows.into_iter().map(Into::into).collect();
        if let Some(r) = rows.iter().find(|r| r.len() != star.len()) {
            return Err(Error::new(
                ErrorKind::RelationArity,
                format!(
                    "a row has {} values, star {star:?} has {} wires",
                    r.len(),
                    star.len()
                ),
            ));
        }
        Ok(Self { star, rows })
    }

    /// The empty relation.
    pub fn empty(star: Star) -> Self {
        Self {
            star,
            rows: BTreeSet::new(),
        }
    }

    /// All rows of `∏ τ(x)` over the declared domains that satisfy `predicate`.
    ///
    /// # Errors
    /// [`ErrorKind::MissingDomain`] if a wire's type has no domain.
    pub fn from_predicate(
        star: Star,
        domains: &Domains<V>,
        mut predicate: impl FnMut(&[V]) -> bool,
    ) -> Result<Self> {
        let doms = star
            .types()
            .iter()
            .map(|t| domain(domains, t))
            .collect::<Result<Vec<_>>>()?;
        let mut rows = BTreeSet::new();
        if doms.iter().all(|d| !d.is_empty()) {
            let mut idx = vec![0usize; doms.len()];
            let mut row: Vec<V> = doms.iter().map(|d| d[0].clone()).collect();
            loop {
                if predicate(&row) {
                    rows.insert(row.clone().into_boxed_slice());
                }
                // odometer increment, last wire fastest
                let mut k = doms.len();
                loop {
                    if k == 0 {
                        return Ok(Self { star, rows });
                    }
                    k -= 1;
                    idx[k] += 1;
                    if idx[k] < doms[k].len() {
                        row[k] = doms[k][idx[k]].clone();
                        break;
                    }
                    idx[k] = 0;
                    row[k] = doms[k][0].clone();
                }
            }
        }
        Ok(Self { star, rows })
    }

    /// `∏ τ(x)` over the declared domains.
    ///
    /// # Errors
    /// [`ErrorKind::MissingDomain`] if a wire's type has no domain.
    pub fn full(star: Star, domains: &Domains<V>) -> Result<Self> {
        Self::from_predicate(star, domains, |_| true)
    }

    /// Join in the semilattice `JRel(X)` (Spivak, Proposition 4.3.1).
    ///
    /// # Errors
    /// [`ErrorKind::StarMismatch`] if the stars differ.
    pub fn union(&self, other: &Self) -> Result<Self> {
        if self.star != other.star {
            return Err(Error::new(
                ErrorKind::StarMismatch,
                format!("{:?} vs {:?}", self.star, other.star),
            ));
        }
        Ok(Self {
            star: self.star.clone(),
            rows: self.rows.union(&other.rows).cloned().collect(),
        })
    }
}

impl<V> Relation<V> {
    /// The star the relation is on.
    pub fn star(&self) -> &Star {
        &self.star
    }

    /// The rows, in ascending order.
    pub fn rows(&self) -> impl ExactSizeIterator<Item = &[V]> {
        self.rows.iter().map(|r| &**r)
    }

    /// Number of rows.
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    /// Whether there are no rows.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Whether `row` is in the relation.
    pub fn contains(&self, row: &[V]) -> bool
    where
        V: Ord,
    {
        self.rows.contains(row)
    }
}

fn domain<'d, V>(domains: &'d Domains<V>, ty: &str) -> Result<&'d [V]> {
    domains.get(ty).map(Vec::as_slice).ok_or_else(|| {
        Error::new(
            ErrorKind::MissingDomain,
            format!("no finite domain declared for type {ty:?}"),
        )
    })
}

struct Table<V> {
    cols: Vec<Cable>,
    rows: HashSet<Box<[V]>>,
}

/// `Rel(φ)(R₁, …, Rₙ)`, the φ-conjunction of the relations.
///
/// # Errors
/// [`ErrorKind::ArityMismatch`] and [`ErrorKind::StarMismatch`] for arguments
/// that do not fit `phi`, and [`ErrorKind::MissingDomain`] when an output-only
/// or floating cable's type has no declared domain.
pub fn apply<V: Clone + Ord + Hash>(
    phi: &WiringDiagram,
    relations: &[Relation<V>],
    domains: &Domains<V>,
) -> Result<Relation<V>> {
    if relations.len() != phi.arity() {
        return Err(Error::new(
            ErrorKind::ArityMismatch,
            format!(
                "diagram has {} inner stars, got {} relations",
                phi.arity(),
                relations.len()
            ),
        ));
    }
    let k = phi.cables().len();
    let mut constrained = vec![false; k];
    let mut tables = Vec::with_capacity(relations.len() + 1);
    for (i, r) in relations.iter().enumerate() {
        if r.star != phi.inner()[i] {
            return Err(Error::new(
                ErrorKind::StarMismatch,
                format!(
                    "relation {i} is on {:?}, expected {:?}",
                    r.star,
                    phi.inner()[i]
                ),
            ));
        }
        let wiring = phi.inner_cables(i);
        for &c in wiring {
            constrained[c as usize] = true;
        }
        tables.push(select(wiring, &r.rows));
    }
    for &c in phi.outer_cables() {
        if !constrained[c as usize] {
            let dom = domain(domains, &phi.cables()[c as usize])?;
            tables.push(Table {
                cols: vec![c],
                rows: dom.iter().map(|v| Box::from([v.clone()])).collect(),
            });
            constrained[c as usize] = true;
        }
    }
    for (c, ty) in phi.cables().iter().enumerate() {
        if !constrained[c] && domain(domains, ty)?.is_empty() {
            return Ok(Relation::empty(phi.outer().clone()));
        }
    }

    let keep: HashSet<Cable> = phi.outer_cables().iter().copied().collect();
    let result = join_all(tables, &keep);
    if result.rows.is_empty() {
        // the join may stop early, before every output cable has a column
        return Ok(Relation::empty(phi.outer().clone()));
    }
    let pos: HashMap<Cable, usize> = result
        .cols
        .iter()
        .enumerate()
        .map(|(j, &c)| (c, j))
        .collect();
    let out: Vec<usize> = phi.outer_cables().iter().map(|c| pos[c]).collect();
    let rows = result
        .rows
        .iter()
        .map(|r| out.iter().map(|&j| r[j].clone()).collect())
        .collect();
    Ok(Relation {
        star: phi.outer().clone(),
        rows,
    })
}

/// Turn a relation on `Xᵢ` into a table over its distinct cables.
fn select<V: Clone + Eq + Hash>(wiring: &[Cable], rows: &BTreeSet<Box<[V]>>) -> Table<V> {
    let mut cols = Vec::new();
    let mut reps = Vec::new();
    let mut checks = Vec::new();
    for (w, &c) in wiring.iter().enumerate() {
        if let Some(j) = cols.iter().position(|&d| d == c) {
            checks.push((w, reps[j]));
        } else {
            cols.push(c);
            reps.push(w);
        }
    }
    let rows = rows
        .iter()
        .filter(|r| checks.iter().all(|&(a, b)| r[a] == r[b]))
        .map(|r| reps.iter().map(|&w| r[w].clone()).collect())
        .collect();
    Table { cols, rows }
}

fn join_all<V: Clone + Eq + Hash>(mut remaining: Vec<Table<V>>, keep: &HashSet<Cable>) -> Table<V> {
    remaining.sort_by_key(|t| t.rows.len());
    let mut cur = Table {
        cols: Vec::new(),
        rows: HashSet::from([Box::from([])]),
    };
    while !remaining.is_empty() {
        if cur.rows.is_empty() {
            return cur;
        }
        // most shared cables, then fewest rows, then earliest
        let best = (0..remaining.len())
            .max_by_key(|&j| {
                let shared = remaining[j]
                    .cols
                    .iter()
                    .filter(|c| cur.cols.contains(c))
                    .count();
                (
                    shared,
                    std::cmp::Reverse(remaining[j].rows.len()),
                    std::cmp::Reverse(j),
                )
            })
            .expect("non-empty");
        let next = remaining.remove(best);
        cur = hash_join(&cur, &next);
        let needed = |c: &Cable| keep.contains(c) || remaining.iter().any(|t| t.cols.contains(c));
        cur = project(cur, needed);
    }
    cur
}

fn hash_join<V: Clone + Eq + Hash>(a: &Table<V>, b: &Table<V>) -> Table<V> {
    let shared: Vec<Cable> = a
        .cols
        .iter()
        .copied()
        .filter(|c| b.cols.contains(c))
        .collect();
    let a_key: Vec<usize> = shared
        .iter()
        .map(|c| a.cols.iter().position(|d| d == c).unwrap())
        .collect();
    let b_key: Vec<usize> = shared
        .iter()
        .map(|c| b.cols.iter().position(|d| d == c).unwrap())
        .collect();
    let b_rest: Vec<usize> = (0..b.cols.len())
        .filter(|&j| !shared.contains(&b.cols[j]))
        .collect();
    let mut index: HashMap<Vec<V>, Vec<Vec<V>>> = HashMap::new();
    for r in &b.rows {
        let key = b_key.iter().map(|&j| r[j].clone()).collect();
        index
            .entry(key)
            .or_default()
            .push(b_rest.iter().map(|&j| r[j].clone()).collect());
    }
    let mut rows = HashSet::new();
    for r in &a.rows {
        let key: Vec<V> = a_key.iter().map(|&j| r[j].clone()).collect();
        if let Some(tails) = index.get(&key) {
            for tail in tails {
                rows.insert(r.iter().chain(tail).cloned().collect());
            }
        }
    }
    let cols = a
        .cols
        .iter()
        .copied()
        .chain(b_rest.iter().map(|&j| b.cols[j]))
        .collect();
    Table { cols, rows }
}

fn project<V: Clone + Eq + Hash>(t: Table<V>, needed: impl Fn(&Cable) -> bool) -> Table<V> {
    let keep: Vec<usize> = (0..t.cols.len()).filter(|&j| needed(&t.cols[j])).collect();
    if keep.len() == t.cols.len() {
        return t;
    }
    Table {
        cols: keep.iter().map(|&j| t.cols[j]).collect(),
        rows: t
            .rows
            .iter()
            .map(|r| keep.iter().map(|&j| r[j].clone()).collect())
            .collect(),
    }
}

/// The closing transformation `Rel([Y ⇒ Z]) → [Rel(Y) ⇒ Rel(Z)]` (Definition 5.1.6):
/// `close(q, ys, z)(R₁, …, Rₙ) = Rel(ev)(q, R₁, …, Rₙ)`.
///
/// # Errors
/// [`ErrorKind::HomMismatch`] unless `q` is on `[Y ⇒ Z]`.
pub fn close<'a, V: Clone + Ord + Hash>(
    q: &'a Relation<V>,
    ys: &[Star],
    z: &Star,
    domains: &'a Domains<V>,
) -> Result<impl Fn(&[Relation<V>]) -> Result<Relation<V>> + 'a> {
    let ev = evaluation(ys, z);
    if q.star != ev.inner()[0] {
        return Err(Error::new(
            ErrorKind::HomMismatch,
            format!("{:?} is not [Y ⇒ Z]", q.star),
        ));
    }
    Ok(move |rs: &[Relation<V>]| {
        let args: Vec<Relation<V>> = std::iter::once(q.clone())
            .chain(rs.iter().cloned())
            .collect();
        apply(&ev, &args, domains)
    })
}

/// The greatest recursive relation of a recursive setup (Spivak, §5.2).
///
/// `phi: X₁, …, Xₙ → [Z ⇒ Z]` together with `relations` fills the slot to give a
/// monotone `q: Rel(Z) → Rel(Z)`. Iterating `q` from the full relation reaches
/// the greatest fixed point in at most `|∏ τ| + 1` steps. Every fixed point is
/// contained in it. If it is empty, no non-empty recursive relation exists.
///
/// # Errors
/// [`ErrorKind::HomMismatch`] unless `phi.outer() == [Z ⇒ Z]`, plus those of [`apply`].
pub fn recursive<V: Clone + Ord + Hash>(
    phi: &WiringDiagram,
    relations: &[Relation<V>],
    z: &Star,
    domains: &Domains<V>,
) -> Result<Relation<V>> {
    let hom = internal_hom(std::slice::from_ref(z), z);
    if *phi.outer() != hom {
        return Err(Error::new(
            ErrorKind::HomMismatch,
            format!("outer star {:?} is not [Z ⇒ Z] = {hom:?}", phi.outer()),
        ));
    }
    let q = apply(phi, relations, domains)?;
    let step = close(&q, std::slice::from_ref(z), z, domains)?;
    let mut current = Relation::full(z.clone(), domains)?;
    loop {
        let next = step(std::slice::from_ref(&current))?;
        if next == current {
            return Ok(current);
        }
        current = next;
    }
}
