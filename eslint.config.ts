// Unified flat config — single source of truth for the monorepo.
// Run `bun run lint` from the repo root. Per-package configs were removed.
//
// Preset policy (2026 best practice, adapted for incremental adoption):
// - typescript-eslint strictTypeChecked + stylisticTypeChecked: full strength.
// - perfectionist: only import sorting enforced (zero behavior change, autofixable).
//   Full recommended-natural (sort-jsx-props, sort-objects, …) is intentionally
//   NOT enabled — it would churn streaming-adjacent UI code without safety gain.
// - unicorn: curated correctness subset only. Full flat/recommended forces renames
//   (no-null, name-replacements, consistent-compound-words) that change runtime
//   semantics; adopt incrementally.
// - boundaries v7: architectural direction (shared never imports apps).
import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import perfectionist from "eslint-plugin-perfectionist";
import reactHooks from "eslint-plugin-react-hooks";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/public/**",
      "**/.certs/**",
      "**/coverage/**",
      "**/.vitest/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  // Base: parser + project service + curated sorting/correctness + boundaries.
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    plugins: { perfectionist, unicorn, boundaries },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "boundaries/elements": [
        { type: "client", pattern: "apps/client/src/**/*" },
        { type: "server", pattern: "apps/server/src/**/*" },
        { type: "shared", pattern: "packages/shared/src/**/*" },
        { type: "e2e", pattern: "e2e/**/*" },
      ],
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "perfectionist/sort-imports": ["error", { type: "natural", order: "asc" }],
      "perfectionist/sort-named-imports": ["error", { type: "natural", order: "asc" }],
      // Curated unicorn correctness rules (no renames, no semantic changes).
      "unicorn/prefer-node-protocol": "error",
      "unicorn/error-message": "error",
      "unicorn/better-regex": "error",
      "unicorn/no-array-push-push": "error",
      // Architectural direction: shared stays dependency-free of apps;
      // apps never import each other. Same-type imports are allowed.
      "boundaries/dependencies": [
        "error",
        {
          policies: [
            {
              from: { element: { type: "shared" } },
              disallow: {
                to: { element: { types: { anyOf: ["client", "server", "e2e"] } } },
              },
            },
            {
              from: { element: { type: "client" } },
              disallow: { to: { element: { type: "server" } } },
            },
            {
              from: { element: { type: "server" } },
              disallow: { to: { element: { type: "client" } } },
            },
            {
              from: { element: { type: "client" } },
              allow: { to: { element: { type: "client" } } },
            },
            {
              from: { element: { type: "server" } },
              allow: { to: { element: { type: "server" } } },
            },
            {
              from: { element: { type: "shared" } },
              allow: { to: { element: { type: "shared" } } },
            },
            {
              from: { element: { type: "e2e" } },
              allow: {
                to: {
                  element: { types: { anyOf: ["client", "server", "shared", "e2e"] } },
                },
              },
            },
          ],
        },
      ],
      // Numbers in log/progress templates are idiomatic (`${bytesReceived}`).
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Async safety: enforce handling while allowing explicit void for intentional fire-and-forget.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      // Allow void-returning arrow function shorthands like forEach(l => l(error)).
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // Allow type annotations on either variable or constructor without churn.
      "@typescript-eslint/consistent-generic-constructors": "off",
    },
  },
  // Client: browser + React 19 (compiler-aware hooks + @eslint-react).
  {
    files: ["apps/client/**/*.{js,jsx,ts,tsx}"],
    plugins: { eslintReact, "react-hooks": reactHooks },
    extends: [reactHooks.configs.flat["recommended-latest"], eslintReact.configs["recommended-typescript"]],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/no-unnecessary-use-memo": "off",
      "@eslint-react/web-api-no-leaked-timeout": "error",
      "@eslint-react/web-api-no-leaked-interval": "error",
      "@eslint-react/web-api-no-leaked-event-listener": "error",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
    settings: {
      react: { version: "detect" },
    },
  },
  // Server: Bun/Node + strict async handling.
  {
    files: ["apps/server/**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // Shared: dependency-free, no DOM/Node globals assumed.
  {
    files: ["packages/shared/**/*.{ts,mts,cts}"],
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // Tooling / config files and tests: no type-aware linting (not in project references).
  {
    files: [
      "**/*.config.{ts,mts,js,mjs,cjs}",
      "**/vite-env.d.ts",
      "test-setup.ts",
      "e2e/**/*.ts",
      "**/__tests__/**/*.ts",
      "**/*.test.{ts,tsx}",
      "**/test/**/*.ts",
    ],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Must stay last: disables stylistic rules that conflict with Prettier.
  eslintConfigPrettier,
]);
