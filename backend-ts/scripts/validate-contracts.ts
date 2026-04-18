import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts");
const AI_ROOT = path.join(ROOT, "ai");
const FIXTURES_ROOT = path.join(AI_ROOT, "fixtures");
const LEGACY_FIXTURES_ROOT = path.resolve(ROOT, "..", "..", "api", "test", "fixtures");

class ContractValidationError extends Error {}

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function asObject(value: unknown, pathLabel: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError(`${pathLabel}: expected object`);
  }
  return value as JsonObject;
}

function resolveRef(rootSchema: JsonObject, ref: string): JsonObject {
  if (!ref.startsWith("#/")) {
    throw new ContractValidationError(`Unsupported $ref: ${ref}`);
  }

  let node: unknown = rootSchema;
  for (const part of ref.slice(2).split("/")) {
    node = asObject(node, ref)[part];
  }
  return asObject(node, ref);
}

function isTypeMatch(expected: string, value: unknown): boolean {
  if (expected === "object") {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
  if (expected === "array") {
    return Array.isArray(value);
  }
  if (expected === "string") {
    return typeof value === "string";
  }
  if (expected === "integer") {
    return Number.isInteger(value);
  }
  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expected === "boolean") {
    return typeof value === "boolean";
  }
  if (expected === "null") {
    return value === null;
  }
  throw new ContractValidationError(`Unsupported schema type: ${expected}`);
}

function validate(schemaValue: unknown, value: unknown, rootSchema: JsonObject, pathLabel = "$"): void {
  const schema = asObject(schemaValue, pathLabel);

  if (typeof schema.$ref === "string") {
    validate(resolveRef(rootSchema, schema.$ref), value, rootSchema, pathLabel);
    return;
  }

  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try {
        validate(candidate, value, rootSchema, pathLabel);
        matches += 1;
      } catch (error) {
        if (!(error instanceof ContractValidationError)) {
          throw error;
        }
      }
    }
    if (matches !== 1) {
      throw new ContractValidationError(`${pathLabel}: oneOf expected exactly 1 match, got ${matches}`);
    }
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    for (const candidate of schema.anyOf) {
      try {
        validate(candidate, value, rootSchema, pathLabel);
        return;
      } catch (error) {
        if (!(error instanceof ContractValidationError)) {
          throw error;
        }
      }
    }
    throw new ContractValidationError(`${pathLabel}: anyOf had no matching schema`);
  }

  if ("const" in schema && value !== schema.const) {
    throw new ContractValidationError(`${pathLabel}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new ContractValidationError(`${pathLabel}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
  }

  const expectedType = schema.type;
  if (expectedType !== undefined) {
    const allowedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!allowedTypes.every((candidate) => typeof candidate === "string")) {
      throw new ContractValidationError(`${pathLabel}: invalid schema type declaration`);
    }
    if (!allowedTypes.some((typeName) => isTypeMatch(typeName, value))) {
      throw new ContractValidationError(`${pathLabel}: expected type ${JSON.stringify(allowedTypes)}, got ${typeof value}`);
    }
  }

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    throw new ContractValidationError(`${pathLabel}: string shorter than minLength=${schema.minLength}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new ContractValidationError(`${pathLabel}: array shorter than minItems=${schema.minItems}`);
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        validate(schema.items, value[index], rootSchema, `${pathLabel}[${index}]`);
      }
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as JsonObject;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in objectValue)) {
        throw new ContractValidationError(`${pathLabel}: missing required key ${JSON.stringify(key)}`);
      }
    }

    const properties = schema.properties && typeof schema.properties === "object" ? (schema.properties as JsonObject) : {};
    const additional = schema.additionalProperties ?? true;
    for (const [key, item] of Object.entries(objectValue)) {
      const childPath = `${pathLabel}.${key}`;
      if (key in properties) {
        validate(properties[key], item, rootSchema, childPath);
        continue;
      }
      if (additional === false) {
        throw new ContractValidationError(`${pathLabel}: unexpected key ${JSON.stringify(key)}`);
      }
      if (additional && typeof additional === "object" && !Array.isArray(additional)) {
        validate(additional, item, rootSchema, childPath);
      }
    }
  }
}

function validateFixture(schemaName: string, fixtureName: string): void {
  const schemaPath = path.join(AI_ROOT, schemaName);
  const fixturePath = path.join(FIXTURES_ROOT, fixtureName);
  const schema = asObject(loadJson(schemaPath), schemaPath);
  const fixture = loadJson(fixturePath);
  validate(schema, fixture, schema);
  console.log(`PASS schema ${schemaName} <- ${fixtureName}`);
}

function assertJsonEqual(leftPath: string, rightPath: string): void {
  const left = loadJson(leftPath);
  const right = loadJson(rightPath);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new ContractValidationError(`Fixture mismatch between ${leftPath} and ${rightPath}`);
  }
  console.log(`PASS legacy-sync ${path.basename(leftPath)} == ${path.basename(rightPath)}`);
}

const checks: readonly (readonly [string, string])[] = [
  ["source-v1.request.schema.json", "source-v1.request.minimal.json"],
  ["source-v1.response.schema.json", "source-v1.response.non-stream.json"],
  ["source-v1.error.schema.json", "source-v1.response.error.messages-required.json"],
  ["source-v1.stream.schema.json", "source-v1.stream.events.json"],
  ["v2.request.schema.json", "v2.request.minimal.json"],
  ["v2.response.schema.json", "v2.response.non-stream.json"],
  ["v2.stream.schema.json", "v2.stream.events.json"],
];

for (const [schemaName, fixtureName] of checks) {
  validateFixture(schemaName, fixtureName);
}

assertJsonEqual(
  path.join(FIXTURES_ROOT, "source-v1.request.minimal.json"),
  path.join(LEGACY_FIXTURES_ROOT, "ai_request_minimal.json"),
);
assertJsonEqual(
  path.join(FIXTURES_ROOT, "source-v1.response.non-stream.json"),
  path.join(LEGACY_FIXTURES_ROOT, "ai_response_non_stream.json"),
);
assertJsonEqual(
  path.join(FIXTURES_ROOT, "source-v1.stream.events.json"),
  path.join(LEGACY_FIXTURES_ROOT, "ai_stream_events.json"),
);
