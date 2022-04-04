import MagicString from "magic-string";
import { assert } from "./assert";

export interface Change {
  range: [number, number];
  replacement: string;
}

export function applyChanges(code: MagicString, changes: Change[]) {
  changes.sort((a, b) => a.range[0] - b.range[0]);

  let prevIndex = 0;
  for (const change of changes) {
    assert(change.range[0] >= prevIndex, "changes are disjoint");
    code.overwrite(change.range[0], change.range[1], change.replacement);
    prevIndex = change.range[1];
  }
}
