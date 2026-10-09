"""Every spec file validates against spec/schema/wiring-diagrams.schema.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

SPEC = Path(__file__).resolve().parents[2] / "spec"
SCHEMA = json.loads((SPEC / "schema" / "wiring-diagrams.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(SCHEMA)


def validator(ref: str) -> Draft202012Validator:
    """A validator for one definition of the schema."""
    return Draft202012Validator({"$ref": f"#/$defs/{ref}", "$defs": SCHEMA["$defs"]})


@pytest.mark.parametrize("path", sorted((SPEC / "examples").glob("*.json")), ids=lambda p: p.stem)
def test_examples(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    if path.stem == "index":
        return
    validator("example").validate(data)


def test_conformance_diagrams() -> None:
    """Every diagram in the suite that is expected to parse is schema-valid."""
    diagram = validator("diagram")
    for family in ("compose", "permute", "closed", "rel", "eq", "map_types"):
        for case in json.loads((SPEC / "conformance" / f"{family}.json").read_text())["cases"]:
            for key in ("diagram", "expected"):
                if isinstance(case.get(key), dict) and "cables" in case[key]:
                    diagram.validate(case[key])
    for case in json.loads((SPEC / "conformance" / "canonical.json").read_text())["cases"]:
        if case.get("error") == "invalid_json":
            assert not diagram.is_valid(case["input"]), case["input"]
