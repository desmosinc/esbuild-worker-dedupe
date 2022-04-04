import { RawSourceMap } from "source-map";

export function inlineSourceMapComment(map: string | RawSourceMap) {
  const b64 = Buffer.from(
    typeof map === "string" ? map : JSON.stringify(map)
  ).toString("base64");
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`;
}
