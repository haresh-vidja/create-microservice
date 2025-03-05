import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
    },
    rules: {
      "no-console": "off",
    },
  },
];
