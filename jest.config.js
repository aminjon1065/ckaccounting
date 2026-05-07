// Jest configuration.
//
// We deliberately do NOT use the `jest-expo` preset for the current scope
// of tests. Reason: jest-expo sets up the full Expo runtime (including
// native shims and the `expo/src/winter/runtime.native` import-meta
// registry), which conflicts with React 19 + Expo SDK 55 in non-trivial
// ways. The starter test surface here is pure logic — SyncCoordinator,
// cursor encoding, scope helpers — none of which touch native modules.
//
// When the project starts adding component / native-dependent tests,
// re-introduce `jest-expo` (or `@testing-library/react-native`'s setup)
// in a separate config that runs alongside this one, rather than
// rewiring this minimal preset.

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)", "**/?(*.)+(test).[jt]s?(x)"],
  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": [
      "babel-jest",
      {
        presets: [
          ["@babel/preset-env", { targets: { node: "current" } }],
          "@babel/preset-typescript",
        ],
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Module-level imports of expo / react-native shouldn't reach the test
  // harness at all — pure-logic test files only import the plain TS
  // modules under lib/. If a transitive import sneaks one in, fail loudly
  // by NOT mocking it: that's a sign the module under test should be
  // refactored to keep the boundary clean.
};
