/* eslint-env browser */

// Write all letters of the alphabet to the global scope so we can check that
// the minified variable names used in the main module don't conflict
const letters = "abcdefghijklmnopqrstuvwxyz";
for (const letter of letters.split("")) {
  window[letter] = letter;
}

module.exports = {};
