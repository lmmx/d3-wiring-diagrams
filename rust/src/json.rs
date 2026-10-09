//! The JSON interchange format (`docs/format.md`, `spec/schema/`).
//!
//! The serde impls give the usual `serde_json::{from_str, to_string}`
//! round trip. The `from_json_value` constructors also report *why* input was
//! rejected, with the [`ErrorKind`]s shared with the Python and JS
//! implementations. Shape errors are [`ErrorKind::InvalidJson`]; a well-shaped
//! diagram with a bad cable index is [`ErrorKind::CableOutOfRange`].

use std::collections::BTreeMap;

use serde::de::{DeserializeOwned, Error as _};
use serde::ser::{SerializeMap, SerializeStruct};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::diagram::WiringDiagram;
use crate::eq::Partition;
use crate::error::{Error, ErrorKind, Result};
use crate::rel::Relation;
use crate::scalar::Scalar;
use crate::star::Star;
use crate::term::Term;

impl Serialize for Scalar {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::Bool(b) => s.serialize_bool(*b),
            Self::Int(i) => s.serialize_i64(*i),
            Self::Str(v) => s.serialize_str(v),
            Self::Null => s.serialize_unit(),
        }
    }
}

impl<'de> Deserialize<'de> for Scalar {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        match Value::deserialize(d)? {
            Value::Bool(b) => Ok(Self::Bool(b)),
            Value::Number(n) => n
                .as_i64()
                .map(Self::Int)
                .ok_or_else(|| D::Error::custom("non-integer number")),
            Value::String(s) => Ok(Self::Str(s.into())),
            Value::Null => Ok(Self::Null),
            _ => Err(D::Error::custom("expected a JSON scalar")),
        }
    }
}

fn invalid(what: &str, e: impl std::fmt::Display) -> Error {
    Error::new(ErrorKind::InvalidJson, format!("{what}: {e}"))
}

// -- Star ---------------------------------------------------------------------------

impl Serialize for Star {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(self.len()))?;
        for (n, t) in self.iter() {
            map.serialize_entry(n, t)?;
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for Star {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let wires = BTreeMap::<String, String>::deserialize(d)?;
        Star::new(wires).map_err(D::Error::custom)
    }
}

impl Star {
    /// Parse `{name: type}`.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidJson`] for any other shape.
    pub fn from_json_value(v: Value) -> Result<Self> {
        let wires: BTreeMap<String, String> =
            serde_json::from_value(v).map_err(|e| invalid("a star is {name: type}", e))?;
        Star::new(wires)
    }
}

// -- WiringDiagram ---------------------------------------------------------------------

impl Serialize for WiringDiagram {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        // BTreeMap<&str, _> iterates in byte order, which is the canonical wire order.
        let inner: Vec<BTreeMap<&str, u32>> = (0..self.arity())
            .map(|i| self.inner_wiring(i).collect())
            .collect();
        let mut st = s.serialize_struct("WiringDiagram", 3)?;
        st.serialize_field(
            "cables",
            &self.cables().iter().map(|t| &**t).collect::<Vec<_>>(),
        )?;
        st.serialize_field("inner", &inner)?;
        st.serialize_field("outer", &self.outer_wiring().collect::<BTreeMap<_, _>>())?;
        st.end()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDiagram {
    cables: Vec<String>,
    inner: Vec<BTreeMap<String, i64>>,
    outer: BTreeMap<String, i64>,
}

impl RawDiagram {
    fn build(self) -> Result<WiringDiagram> {
        let k = self.cables.len();
        let index = |(n, c): (String, i64)| -> Result<(String, usize)> {
            match usize::try_from(c) {
                Ok(c) if c < k => Ok((n, c)),
                _ => Err(Error::new(
                    ErrorKind::CableOutOfRange,
                    format!("wire {n:?} -> cable {c}, but there are {k} cables"),
                )),
            }
        };
        let inner = self
            .inner
            .into_iter()
            .map(|m| m.into_iter().map(index).collect::<Result<Vec<_>>>())
            .collect::<Result<Vec<_>>>()?;
        let outer = self
            .outer
            .into_iter()
            .map(index)
            .collect::<Result<Vec<_>>>()?;
        WiringDiagram::new(self.cables, inner, outer)
    }
}

impl<'de> Deserialize<'de> for WiringDiagram {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        RawDiagram::deserialize(d)?
            .build()
            .map_err(D::Error::custom)
    }
}

const DIAGRAM_SHAPE: &str =
    "a wiring diagram is {cables: [type], inner: [{wire: cable}], outer: {wire: cable}}";

impl WiringDiagram {
    /// Parse `{cables, inner, outer}`.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidJson`] for a wrong shape, and
    /// [`ErrorKind::CableOutOfRange`] for a bad cable index.
    pub fn from_json_value(v: Value) -> Result<Self> {
        let raw: RawDiagram = serde_json::from_value(v).map_err(|e| invalid(DIAGRAM_SHAPE, e))?;
        raw.build()
    }

    /// Parse a JSON string. See [`from_json_value`](Self::from_json_value).
    ///
    /// # Errors
    /// As [`from_json_value`](Self::from_json_value).
    pub fn from_json(s: &str) -> Result<Self> {
        let raw: RawDiagram = serde_json::from_str(s).map_err(|e| invalid(DIAGRAM_SHAPE, e))?;
        raw.build()
    }

    /// The canonical JSON value of this diagram.
    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(self).expect("diagrams always serialise")
    }
}

// -- Term ----------------------------------------------------------------------------

impl Serialize for Term {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(None)?;
        map.serialize_entry("diagram", self.diagram())?;
        if self.children().iter().any(Option::is_some) {
            map.serialize_entry("children", self.children())?;
        }
        if self.labels().iter().any(Option::is_some) {
            map.serialize_entry("labels", self.labels())?;
        }
        if let Some(label) = self.label() {
            map.serialize_entry("label", label)?;
        }
        map.end()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTerm {
    diagram: Value,
    #[serde(default)]
    children: Option<Vec<Option<Value>>>,
    #[serde(default)]
    labels: Option<Vec<Option<String>>>,
    #[serde(default)]
    label: Option<String>,
}

impl Term {
    /// Parse `{diagram, children?, labels?, label?}`.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidJson`] for a wrong shape, plus those of
    /// [`WiringDiagram::from_json_value`] and [`Term::new`].
    pub fn from_json_value(v: Value) -> Result<Self> {
        let raw: RawTerm = serde_json::from_value(v)
            .map_err(|e| invalid("a term is {diagram, children?, labels?, label?}", e))?;
        let diagram = WiringDiagram::from_json_value(raw.diagram)?;
        let n = diagram.arity();
        let children = match raw.children {
            None => vec![None; n],
            Some(kids) => kids
                .into_iter()
                .map(|k| k.map(Term::from_json_value).transpose())
                .collect::<Result<_>>()?,
        };
        Term::new(
            diagram,
            children,
            raw.labels.unwrap_or_else(|| vec![None; n]),
            raw.label,
        )
    }
}

impl<'de> Deserialize<'de> for Term {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        Term::from_json_value(Value::deserialize(d)?).map_err(D::Error::custom)
    }
}

// -- Relation, Partition --------------------------------------------------------------

impl<V: Serialize> Serialize for Relation<V> {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Relation", 2)?;
        st.serialize_field(
            "wires",
            &self.star().names().iter().map(|n| &**n).collect::<Vec<_>>(),
        )?;
        st.serialize_field("rows", &self.rows().collect::<Vec<_>>())?;
        st.end()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRelation<V> {
    wires: Vec<String>,
    rows: Vec<Vec<V>>,
}

impl<V: Clone + Ord + std::hash::Hash + DeserializeOwned> Relation<V> {
    /// Parse `{wires: [name], rows: [[value]]}` as a relation on `star`.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidJson`] for a wrong shape, [`ErrorKind::StarMismatch`]
    /// if `wires` is not `star`'s names in canonical order, and
    /// [`ErrorKind::RelationArity`] for a row of the wrong length.
    pub fn from_json_value(star: Star, v: Value) -> Result<Self> {
        let raw: RawRelation<V> = serde_json::from_value(v)
            .map_err(|e| invalid("a relation is {wires: [name], rows: [[value]]}", e))?;
        if !raw
            .wires
            .iter()
            .map(String::as_str)
            .eq(star.names().iter().map(|n| &**n))
        {
            return Err(Error::new(
                ErrorKind::StarMismatch,
                format!("relation on wires {:?}, expected {star:?}", raw.wires),
            ));
        }
        Relation::new(star, raw.rows)
    }
}

impl Partition {
    /// Parse `[block id]`, one non-negative integer per wire of `star`.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidJson`] unless `v` is an array, and
    /// [`ErrorKind::InvalidPartition`] for a wrong length or a bad block id.
    pub fn from_json_value(star: Star, v: &Value) -> Result<Self> {
        let items = v
            .as_array()
            .ok_or_else(|| invalid("a partition", "expected an array"))?;
        let blocks = items
            .iter()
            .map(|b| b.as_u64().and_then(|b| u32::try_from(b).ok()))
            .collect::<Option<Vec<u32>>>()
            .ok_or_else(|| {
                Error::new(
                    ErrorKind::InvalidPartition,
                    format!("{v} has a bad block id"),
                )
            })?;
        Partition::new(star, &blocks)
    }
}
