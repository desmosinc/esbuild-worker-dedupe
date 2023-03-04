import * as acorn from "acorn";
import * as estree from "estree";
import MagicString from "magic-string";
import { Context } from "./context";

export function replaceExports(
  context: Context,
  code: MagicString,
  namedExportsObjectVariable: string,
  defaultExportVariable: string | undefined
) {
  context.time("repaceExports::acorn");
  const node = acorn.parse(code.original, {
    sourceType: "module",
    ecmaVersion: 2020,
  }) as acorn.Node & estree.Program;
  context.timeEnd("repaceExports::acorn");

  for (const statement of node.body) {
    if (statement.type === "ExportNamedDeclaration") {
      const replacement = compileExport(statement, namedExportsObjectVariable);
      const { start, end } = statement as acorn.Node & estree.Node;
      code.overwrite(start, end, replacement);
      code.addSourcemapLocation(start);
      code.addSourcemapLocation(end);
    } else if (statement.type === "ExportDefaultDeclaration") {
      if (!defaultExportVariable) {
        throw new Error(
          `Unexpected default export: "${getSource(code, statement)}"`
        );
      }

      const { start, end } = statement as acorn.Node & estree.Node;
      const exportValue = getSource(code, statement.declaration);

      code.overwrite(
        start,
        end,
        `const ${defaultExportVariable} = ${exportValue}`
      );
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

function getSource(code: MagicString, node: estree.Node) {
  const { start, end } = node as estree.Node & acorn.Node;
  return code.original.slice(start, end);
}
