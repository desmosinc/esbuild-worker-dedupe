import {
  RawSourceMap,
  SourceMapConsumer,
  SourceMapGenerator,
} from "source-map";

export async function composeSourceMaps(opts: {
  currentMap: RawSourceMap;
  previousMap: {
    sourceFile: string;
    map: RawSourceMap;
  };
}) {
  const prev = await new SourceMapConsumer(opts.previousMap.map);
  const current = await new SourceMapConsumer(opts.currentMap);
  const gen = SourceMapGenerator.fromSourceMap(current);
  gen.applySourceMap(prev, opts.previousMap.sourceFile);
  return gen.toJSON();
}

export function inlineSourceMapComment(map: string | RawSourceMap) {
  const b64 = Buffer.from(
    typeof map === "string" ? map : JSON.stringify(map)
  ).toString("base64");
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`;
}
