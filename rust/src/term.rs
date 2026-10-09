//! Operad terms: trees of wiring diagrams ("a wiring diagram of wiring diagrams").

use crate::diagram::WiringDiagram;
use crate::error::{Error, ErrorKind, Result};

/// A wiring diagram whose inner stars may each be filled with another term.
///
/// Labels are presentation only. They live here and never on
/// [`WiringDiagram`], so they cannot affect equality of morphisms.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    diagram: WiringDiagram,
    children: Vec<Option<Term>>,
    labels: Vec<Option<String>>,
    label: Option<String>,
}

impl Term {
    /// A term with every slot filled by `children[i]` (`None` leaves star `i` open).
    ///
    /// # Errors
    /// [`ErrorKind::ArityMismatch`] if the lengths differ from the arity, and
    /// [`ErrorKind::StarMismatch`] if a child's outer star is not the star it fills.
    pub fn new(
        diagram: WiringDiagram,
        children: Vec<Option<Term>>,
        labels: Vec<Option<String>>,
        label: Option<String>,
    ) -> Result<Self> {
        let n = diagram.arity();
        if children.len() != n || labels.len() != n {
            return Err(Error::new(
                ErrorKind::ArityMismatch,
                format!(
                    "term over a diagram of arity {n} has {} children and {} labels",
                    children.len(),
                    labels.len()
                ),
            ));
        }
        for (i, kid) in children.iter().enumerate() {
            if let Some(kid) = kid {
                if kid.diagram.outer() != &diagram.inner()[i] {
                    return Err(Error::new(
                        ErrorKind::StarMismatch,
                        format!(
                            "child {i} has outer star {:?}, expected {:?}",
                            kid.diagram.outer(),
                            diagram.inner()[i]
                        ),
                    ));
                }
            }
        }
        Ok(Self {
            diagram,
            children,
            labels,
            label,
        })
    }

    /// A term with no children and no labels.
    pub fn leaf(diagram: WiringDiagram) -> Self {
        let n = diagram.arity();
        Self {
            diagram,
            children: vec![None; n],
            labels: vec![None; n],
            label: None,
        }
    }

    /// The diagram at the root.
    pub fn diagram(&self) -> &WiringDiagram {
        &self.diagram
    }

    /// The sub-terms, one per inner star of the root diagram.
    pub fn children(&self) -> &[Option<Term>] {
        &self.children
    }

    /// Labels of the root diagram's inner stars.
    pub fn labels(&self) -> &[Option<String>] {
        &self.labels
    }

    /// Label of the root diagram's outer star.
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }

    /// Compose the tree bottom-up. Open slots are filled with identities.
    pub fn evaluate(&self) -> WiringDiagram {
        if self.children.iter().all(Option::is_none) {
            return self.diagram.clone();
        }
        let kids: Vec<WiringDiagram> = self
            .children
            .iter()
            .zip(self.diagram.inner())
            .map(|(kid, x)| {
                kid.as_ref()
                    .map_or_else(|| WiringDiagram::identity(x), Term::evaluate)
            })
            .collect();
        self.diagram
            .compose(&kids)
            .expect("stars were checked when the term was built")
    }

    /// Labels of the inner stars of [`evaluate`](Self::evaluate), in order.
    pub fn leaf_labels(&self) -> Vec<Option<String>> {
        self.children
            .iter()
            .zip(&self.labels)
            .flat_map(|(kid, name)| match kid {
                Some(kid) => kid.leaf_labels(),
                None => vec![name.clone()],
            })
            .collect()
    }
}
