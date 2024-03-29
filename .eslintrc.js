/* eslint-env node */
module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "no-console": ["error"],
  },
  overrides: [
    {
      files: ["example/**/*.*"],
      rules: {
        "no-console": ["off"],
      },
    },
    {
      files: ["test/**/*.*"],
      rules: {
        "no-console": ["off"],
      },
    },
  ],
};
