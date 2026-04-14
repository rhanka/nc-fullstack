#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
AI_ROOT = ROOT / "ai"
FIXTURES_ROOT = AI_ROOT / "fixtures"
LEGACY_FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "api" / "test" / "fixtures"


class ValidationError(Exception):
    pass


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_ref(root_schema: dict, ref: str):
    if not ref.startswith("#/"):
        raise ValidationError(f"Unsupported $ref: {ref}")
    node = root_schema
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def is_type_match(expected: str, value) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return (isinstance(value, int) or isinstance(value, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    raise ValidationError(f"Unsupported schema type: {expected}")


def validate(schema: dict, value, root_schema: dict, path: str = "$") -> None:
    if "$ref" in schema:
        validate(resolve_ref(root_schema, schema["$ref"]), value, root_schema, path)
        return

    if "oneOf" in schema:
        errors = []
        matches = 0
        for candidate in schema["oneOf"]:
            try:
                validate(candidate, value, root_schema, path)
                matches += 1
            except ValidationError as exc:
                errors.append(str(exc))
        if matches != 1:
            raise ValidationError(f"{path}: oneOf expected exactly 1 match, got {matches}")
        return

    if "anyOf" in schema:
        for candidate in schema["anyOf"]:
            try:
                validate(candidate, value, root_schema, path)
                return
            except ValidationError:
                continue
        raise ValidationError(f"{path}: anyOf had no matching schema")

    if "const" in schema and value != schema["const"]:
        raise ValidationError(f"{path}: expected const {schema['const']!r}, got {value!r}")

    if "enum" in schema and value not in schema["enum"]:
        raise ValidationError(f"{path}: expected one of {schema['enum']!r}, got {value!r}")

    expected_type = schema.get("type")
    if expected_type is not None:
        allowed_types = expected_type if isinstance(expected_type, list) else [expected_type]
        if not any(is_type_match(type_name, value) for type_name in allowed_types):
            raise ValidationError(f"{path}: expected type {allowed_types!r}, got {type(value).__name__}")

    if isinstance(value, str) and "minLength" in schema and len(value) < schema["minLength"]:
        raise ValidationError(f"{path}: string shorter than minLength={schema['minLength']}")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            raise ValidationError(f"{path}: array shorter than minItems={schema['minItems']}")
        item_schema = schema.get("items")
        if item_schema is not None:
            for index, item in enumerate(value):
                validate(item_schema, item, root_schema, f"{path}[{index}]")

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                raise ValidationError(f"{path}: missing required key {key!r}")
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            child_path = f"{path}.{key}"
            if key in properties:
                validate(properties[key], item, root_schema, child_path)
                continue
            if additional is False:
                raise ValidationError(f"{path}: unexpected key {key!r}")
            if isinstance(additional, dict):
                validate(additional, item, root_schema, child_path)


def validate_fixture(schema_name: str, fixture_name: str) -> None:
    schema_path = AI_ROOT / schema_name
    fixture_path = FIXTURES_ROOT / fixture_name
    schema = load_json(schema_path)
    fixture = load_json(fixture_path)
    validate(schema, fixture, schema)
    print(f"PASS schema {schema_name} <- {fixture_name}")


def assert_json_equal(left_path: Path, right_path: Path) -> None:
    left = load_json(left_path)
    right = load_json(right_path)
    if left != right:
        raise ValidationError(f"Fixture mismatch between {left_path} and {right_path}")
    print(f"PASS legacy-sync {left_path.name} == {right_path.name}")


def main() -> None:
    checks = [
        ("source-v1.request.schema.json", "source-v1.request.minimal.json"),
        ("source-v1.response.schema.json", "source-v1.response.non-stream.json"),
        ("source-v1.error.schema.json", "source-v1.response.error.messages-required.json"),
        ("source-v1.stream.schema.json", "source-v1.stream.events.json"),
        ("v2.request.schema.json", "v2.request.minimal.json"),
        ("v2.response.schema.json", "v2.response.non-stream.json"),
        ("v2.stream.schema.json", "v2.stream.events.json")
    ]
    for schema_name, fixture_name in checks:
        validate_fixture(schema_name, fixture_name)

    assert_json_equal(
        FIXTURES_ROOT / "source-v1.request.minimal.json",
        LEGACY_FIXTURES_ROOT / "ai_request_minimal.json",
    )
    assert_json_equal(
        FIXTURES_ROOT / "source-v1.response.non-stream.json",
        LEGACY_FIXTURES_ROOT / "ai_response_non_stream.json",
    )
    assert_json_equal(
        FIXTURES_ROOT / "source-v1.stream.events.json",
        LEGACY_FIXTURES_ROOT / "ai_stream_events.json",
    )


if __name__ == "__main__":
    main()
