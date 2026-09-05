'use strict';

/**
 * Minimal JSON Schema (draft 2020-12 subset) validator for the run summary,
 * shared by every test that checks an emitted summary against
 * schema/run-summary.v1.json.
 *
 * Only implements the keywords this repo's own schema uses ($ref, oneOf,
 * const, enum, type, format: date-time, required, additionalProperties).
 * Not a general-purpose validator — just enough to prove the schema file and
 * buildRunSummary's actual output agree, without adding a dependency.
 */

const { readFileSync } = require('fs');
const path = require('path');

const schema = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'schema', 'run-summary.v1.json'), 'utf8')
);

function validateAgainstSchema(node, value, defs) {
  if (node.$ref) {
    return validateAgainstSchema(defs[node.$ref.replace('#/$defs/', '')], value, defs);
  }
  if (node.oneOf) {
    const matches = node.oneOf.filter((sub) => {
      try { validateAgainstSchema(sub, value, defs); return true; } catch { return false; }
    });
    if (matches.length !== 1) {
      throw new Error(`oneOf: expected exactly one branch to match, got ${matches.length} for ${JSON.stringify(value)}`);
    }
    return true;
  }
  if (node.const !== undefined) {
    if (value !== node.const) throw new Error(`expected const ${node.const}, got ${JSON.stringify(value)}`);
    return true;
  }
  if (node.enum) {
    if (!node.enum.includes(value)) throw new Error(`expected one of ${node.enum.join('/')}, got ${JSON.stringify(value)}`);
    return true;
  }
  switch (node.type) {
    case 'null':
      if (value !== null) throw new Error(`expected null, got ${JSON.stringify(value)}`);
      return true;
    case 'string':
      if (typeof value !== 'string') throw new Error(`expected string, got ${JSON.stringify(value)}`);
      if (node.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        throw new Error(`expected a parseable date-time, got ${JSON.stringify(value)}`);
      }
      return true;
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`expected boolean, got ${JSON.stringify(value)}`);
      return true;
    case 'integer':
      if (!Number.isInteger(value)) throw new Error(`expected integer, got ${JSON.stringify(value)}`);
      if (node.minimum !== undefined && value < node.minimum) throw new Error(`${value} below minimum ${node.minimum}`);
      return true;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`expected object, got ${JSON.stringify(value)}`);
      }
      for (const key of node.required ?? []) {
        if (!(key in value)) throw new Error(`missing required key "${key}"`);
      }
      for (const key of Object.keys(value)) {
        if (node.additionalProperties === false && !(key in (node.properties ?? {}))) {
          throw new Error(`unexpected key "${key}" (additionalProperties: false)`);
        }
        if (node.properties?.[key]) validateAgainstSchema(node.properties[key], value[key], defs);
      }
      return true;
    }
    default:
      throw new Error(`unsupported schema node: ${JSON.stringify(node)}`);
  }
}

module.exports = { schema, validateAgainstSchema };
