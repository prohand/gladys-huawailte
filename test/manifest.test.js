// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest shape; only these tests know which
// handlers the code registers, which defaults it uses, which triggers it fires.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTION_KEYS } from '../src/capabilities/actions.js';
import { SCENE_ACTION_KEYS } from '../src/capabilities/scenes.js';
import { TRIGGERS, WIDGET_KEY } from '../src/service.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Every form field the manifest declares (same grammar everywhere).
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language text of the manifest, with its path.
function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      yield* texts(item, `${path}[${index}]`);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (
        ['label', 'description', 'placeholder'].includes(key) &&
        value &&
        typeof value === 'object'
      ) {
        yield [`${path}.${key}`, value];
      } else {
        yield* texts(value, `${path}.${key}`);
      }
    }
  }
}

test('every text of the manifest exists in English, French, German and Spanish', () => {
  for (const [path, value] of texts(manifest)) {
    for (const language of LANGUAGES) {
      assert.equal(typeof value[language], 'string', `${path}.${language} is missing`);
      assert.ok(value[language].trim(), `${path}.${language} is empty`);
    }
  }
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), [...ACTION_KEYS].sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), [...SCENE_ACTION_KEYS].sort());
});

test('every trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('the widget key is the one the code serves', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
});

test('config_schema defaults equal DEFAULT_CONFIG, and every stored key is known', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} is missing from DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('secret fields have no default', () => {
  for (const field of allFields.filter((f) => f.type === 'secret')) {
    assert.equal(field.default, undefined, field.key);
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('placeholders only on string, number and secret fields', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.ok(['string', 'number', 'secret'].includes(field.type), field.key);
  }
});

test('section links are https', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${language}: ${text.length}`);
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, text);
    }
  }
});

test('the router is a local device integration', () => {
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['local']);
});

test('countries are ISO codes, 1 to 20 of them', () => {
  assert.ok(Array.isArray(manifest.countries));
  assert.ok(manifest.countries.length >= 1 && manifest.countries.length <= 20);
  assert.equal(new Set(manifest.countries).size, manifest.countries.length, 'no duplicate');
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('keywords: 1 to 10 unique terms of 2 to 30 characters', () => {
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const normalized = manifest.keywords.map((k) => k.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length);
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('categories: 1 to 3 from the store vocabulary', () => {
  const vocabulary = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
    'transport',
    'vehicles',
    'servers',
    'leisure',
  ];
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(vocabulary.includes(category), category);
  }
});

test('gladys_version covers every field declared (countries and keywords: 5.3.0)', () => {
  // Older cores reject unknown manifest fields: the minimum must cover them.
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]), manifest.gladys_version);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-huawailte:${manifest.version}`);
});

test('the user documentation exists in the four languages, with the same sections', async () => {
  const files = (await readdir(new URL('../docs/', import.meta.url))).sort();
  assert.deepEqual(files, LANGUAGES.map((language) => `${language}.md`).sort());
  const counts = {};
  for (const language of LANGUAGES) {
    const doc = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    counts[language] = (doc.match(/^#{1,3} /gm) ?? []).length;
  }
  for (const language of LANGUAGES) {
    assert.equal(
      counts[language],
      counts.en,
      `docs/${language}.md has ${counts[language]} headings`,
    );
  }
});
