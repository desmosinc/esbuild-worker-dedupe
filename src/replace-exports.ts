import * as acorn from "acorn";
import * as estree from "estree";
import MagicString from "magic-string";
import { Context } from "./context";

export function replaceExports(
  context: Context,
  code: MagicString,
  exportsVariable: string
) {
  context.time("repaceExports::acorn");
  const node = acorn.parse(code.original, {
    sourceType: "module",
    ecmaVersion: 2020,
  }) as acorn.Node & estree.Program;
  context.timeEnd("repaceExports::acorn");

  for (const statement of node.body) {
    if (statement.type === "ExportNamedDeclaration") {
      const replacement = compileExport(statement, exportsVariable);
      const { start, end } = statement as acorn.Node & estree.Node;
      code.overwrite(start, end, replacement);
      code.addSourcemapLocation(start);
      code.addSourcemapLocation(end);
    }
  }
}

function compileExport(e: estree.ExportNamedDeclaration, target: string) {
  if (!e.declaration) {
    // export {a, v1 as b, ...}
    return e.specifiers
      .map(
        (spec) =>
          `Object.defineProperty(${target}, '${spec.exported.name}', { get: () => ${spec.local.name} });`
      )
      .join("\n");
  } else {
    throw new Error("Unimplemented: export with declaration");
  }
}
