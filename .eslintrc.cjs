/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: "detect" },
  },
  ignorePatterns: [
    "build/",
    "node_modules/",
    ".cache/",
    "public/build/",
    "*.config.ts",
    "*.config.js",
  ],
  rules: {},
};
