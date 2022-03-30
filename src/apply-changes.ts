import { assert } from "./assert";

export interface Change {
  range: [number, number];
  replacement: string;
}

export function applyChanges(code: string, changes: Change[]) {
  console.time('applyChanges')
  changes.sort((a, b) => a.range[0] - b.range[0]);

  let prevIndex = 0;
  let out = "";
  for (const change of changes) {
    assert(change.range[0] >= prevIndex, "changes are disjoint");
    out += code.slice(prevIndex, change.range[0]);
    out += change.replacement;
    prevIndex = change.range[1];
  }
  out += code.slice(prevIndex);
  console.timeEnd('applyChanges')
  return out;
}
