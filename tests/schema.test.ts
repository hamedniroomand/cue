import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import * as v from 'valibot';

import { CONFIG_SCHEMA_PATH, CONFIG_SCHEMA_URL, ConfigSchema } from '@/config';

// The published JSON Schema is a hand-written second copy of ConfigSchema —
// editors read it, valibot does not. These tests are the only thing keeping the
// two from drifting, so they compare keys AND defaults, one level into the
// nested objects (models / maxTurns / gate).
const schema = await Bun.file(join(import.meta.dir, '..', CONFIG_SCHEMA_PATH)).json();

/** valibot's `optional(x, default)` exposes `.default`; bare optionals do not. */
function valibotDefaults(entries: Record<string, { default?: unknown }>) {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, s]) => s.default !== undefined)
      .map(([k, s]) => [k, s.default]),
  );
}

function jsonDefaults(properties: Record<string, { default?: unknown }>) {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, s]) => s.default !== undefined)
      .map(([k, s]) => [k, s.default]),
  );
}

const sorted = (xs: string[]) => xs.toSorted();

const entries = ConfigSchema.entries as Record<string, any>;
const properties = schema.properties as Record<string, any>;

describe('published config JSON Schema', () => {
  test('declares itself with the URL cue writes into scaffolded configs', () => {
    expect(schema.$id).toBe(CONFIG_SCHEMA_URL);
    expect(CONFIG_SCHEMA_URL.endsWith(CONFIG_SCHEMA_PATH.replace('docs/content/public/', ''))).toBe(
      true,
    );
  });

  test('property names match ConfigSchema exactly, plus $schema itself', () => {
    expect(Object.keys(properties).toSorted()).toEqual(
      ['$schema', ...Object.keys(entries)].toSorted(),
    );
  });

  test('nothing is required — a project may adopt cue with an empty config', () => {
    expect(schema.required).toBeUndefined();
  });

  test('defaults match ConfigSchema defaults', () => {
    expect(jsonDefaults(properties)).toEqual(valibotDefaults(entries));
  });

  test('adapter enum lists every accepted name, aliases included', () => {
    expect(sorted(properties.adapter.enum)).toEqual(sorted(entries.adapter.wrapped.options));
  });

  test.each(['models', 'maxTurns', 'gate'])('nested object %s matches key for key', (key) => {
    expect(Object.keys(properties[key].properties).toSorted()).toEqual(
      Object.keys(entries[key].wrapped.entries).toSorted(),
    );
  });

  test('gate.test is required inside gate; gate.lint is not', () => {
    expect(properties.gate.required).toEqual(['test']);
  });

  test('models requires all three stages — a partial models object is a config error', () => {
    expect(properties.models.required.toSorted()).toEqual(['dev', 'review', 'triage']);
  });

  test('repo carries the same owner/name pattern valibot enforces', () => {
    const good = 'acme/widgets';
    const bad = 'widgets';
    const re = new RegExp(properties.repo.pattern);
    expect(re.test(good)).toBe(true);
    expect(re.test(bad)).toBe(false);
    expect(v.safeParse(ConfigSchema, { repo: bad }).success).toBe(false);
  });

  test('an example config from the docs validates against the real parser', () => {
    // Guards the schema's own examples: anything we advertise must actually load.
    for (const example of schema.examples ?? []) {
      const r = v.safeParse(ConfigSchema, example);
      expect(r.success).toBe(true);
    }
  });
});
