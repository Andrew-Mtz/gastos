const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  globalIgnores([
    '.expo/**',
    'dist/**',
    'web-build/**',
    'ios/**',
    'android/**',
    'expo-env.d.ts',
  ]),
  expoConfig,
  prettierConfig,
]);
