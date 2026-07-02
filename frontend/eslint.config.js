import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        Event: "readonly",
        fetch: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        getComputedStyle: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        KeyboardEvent: "readonly",
        localStorage: "readonly",
        MouseEvent: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Response: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-constant-binary-expression": "off",
      "no-constant-condition": "off",
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^React$",
      }],
    },
  },
  {
    files: ["src/__tests__/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        afterAll: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        global: "readonly",
        it: "readonly",
        test: "readonly",
        vi: "readonly",
      },
    },
  },
];
