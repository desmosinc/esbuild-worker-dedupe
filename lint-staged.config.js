/* eslint-env node */
module.exports = {
  "*.{ts,js,css,md}": "prettier --write",
  "*.{ts,js,tsx}": "eslint --cache --fix",
  "*.{ts,tsx}": [() => "tsc --noEmit -p tsconfig.json"],
};
