import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-huawailte';

test('moves the Unreleased section under the new version', () => {
  const before = `# Changelog

## [Unreleased]

### Added

- Something.

[Unreleased]: ${REPO}/commits/main
`;
  const after = rollChangelog(before, '1.0.1', '2026-11-20');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-11-20\n\n### Added\n\n- Something\.\n/,
  );
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.HEAD`));
  assert.match(after, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/releases/tag/v1\\.0\\.1`));
});

test('an empty Unreleased section still gets a version heading', () => {
  const after = rollChangelog(
    `## [Unreleased]\n\n[Unreleased]: ${REPO}/compare/v1.0.1...HEAD\n`,
    '1.0.2',
    '2026-11-21',
  );
  assert.match(after, /## \[1\.0\.2\] - 2026-11-21\n\n- Maintenance release/);
  assert.match(after, new RegExp(`\\[1\\.0\\.2\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.v1\\.0\\.2`));
});

test('the same version is never rolled twice', () => {
  const text = `## [Unreleased]\n\n## [1.0.1] - 2026-11-20\n`;
  assert.equal(rollChangelog(text, '1.0.1', '2026-11-20'), text);
});
