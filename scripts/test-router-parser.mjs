import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Package-level Node regression, NOT native deep-link execution or exploit proof.
// Run in its own process: platform/hook barrels are stubbed, but the installed
// getLinkingConfig, routing, parsing and serialization implementations are real.
const require = createRequire(import.meta.url);
const shim = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const core = 'expo-router/build/react-navigation/core/';
const query = require('query-string');
let parseCalls = 0;
const original = query.parse;
query.parse = (...args) => {
  parseCalls++;
  return original(...args);
};
const coreParser = require(core + 'getStateFromPath').getStateFromPath;
shim('react-native', { Platform: { OS: 'ios' } });
shim('expo-modules-core', { Platform: { OS: 'ios' } });
shim('expo-linking', {
  getLinkingURL: () => 'gastos://periods?month=2026-09-01',
  createURL: (p) => 'gastos://' + p,
});
shim('expo-router/build/fork/useLinking', {
  getInitialURLWithTimeout: () => Promise.resolve(null),
});
shim('expo-router/build/react-navigation/native', {
  ...require(core + 'validatePathConfig'),
  ...require(core + 'getActionFromState'),
  getStateFromPath: coreParser,
});
const { getLinkingConfig } = require('expo-router/build/getLinkingConfig');
const { findFocusedRoute } = require('expo-router/build/fork/findFocusedRoute');
const linking = require('expo-router/build/link/linking');
const fork = require('expo-router/build/fork/getStateFromPath');
assert.equal(linking.getStateFromPath, fork.getStateFromPath);
const context = Object.assign(
  () => {
    throw Error('Unexpected route-module load');
  },
  { keys: () => [] },
);
const config = getLinkingConfig(
  {
    children: [
      { route: 'periods', children: [] },
      { route: 'history', children: [] },
    ],
  },
  context,
  () => ({ segments: [] }),
  { metaOnly: true, skipGenerated: true, redirects: [] },
);
for (const [url, expected] of [
  ['/periods?month=2026-09-01', { month: '2026-09-01' }],
  ['/periods?month=%E0%A4&note=caf%C3%A9', { month: '\uFFFD', note: 'café' }],
  ['/history?tag=a&tag=b', { tag: ['a', 'b'] }],
]) {
  const state = config.getStateFromPath(url, config.config);
  assert.deepEqual({ ...findFocusedRoute(state).params }, expected);
  assert(config.getPathFromState(state, config.config));
}
assert.equal(
  parseCalls,
  0,
  'Configured Router must not use query-string.parse.',
);
assert(
  coreParser('/periods?month=2026-09-01', { screens: { periods: 'periods' } }),
);
assert.equal(
  parseCalls,
  1,
  'Control proves deprecated core parser reaches query-string.parse.',
);
console.log(
  'PASS installed Router selects fork/URL parsing for benign normal, malformed and duplicate-key inputs; deprecated parser control is distinct.',
);
