import * as acorn from "acorn";
import * as escope from "escope";
import * as estree from "estree";
import MagicString from "magic-string";
import { assert } from "./assert";
import { Context } from "./context";

export function replaceImports(
  context: Context,
  code: MagicString,
  getExportsObjectName: (i: estree.ImportDeclaration) => string | false
) {
  context.time("replaceImports::acorn");
  const ast = acorn.parse(code.original, {
    sourceType: "module",
    ecmaVersion: 2020,
    ranges: true,
    allowReturnOutsideFunction: true,
    locations: true,
  }) as estree.Node & acorn.Node;
  context.timeEnd("replaceImports::acorn");

  assert(ast.type === "Program", `Unexpected top-level node ${ast.type}`);
  const imports = ast.body.filter(
    (n): n is estree.ImportDeclaration => n.type === "ImportDeclaration"
  );
  const importIdentifiers = new Map<estree.Identifier, string>();
  for (const declaration of imports) {
    const exportsObjectName = getExportsObjectName(declaration);
    if (exportsObjectName) {
      assert(declaration.range, "range");
      code.remove(declaration.range[0], declaration.range[1]);
      code.addSourcemapLocation(declaration.range[0]);
      code.addSourcemapLocation(declaration.range[1]);

      for (const spec of declaration.specifiers) {
        const replacement =
          spec.type === "ImportNamespaceSpecifier"
            ? exportsObjectName
            : spec.type === "ImportDefaultSpecifier"
            ? `${exportsObjectName}.default`
            : `${exportsObjectName}['${spec.imported.name}']`;

        importIdentifiers.set(spec.local, replacement);
      }
    }
  }

  context.time("replaceImports::escope");
  const manager = escope.analyze(ast, {
    optimistic: true,
    sourceType: "module",
    ecmaVersion: 11,
  });
  context.timeEnd("replaceImports::escope");

  for (const scope of manager.scopes) {
    for (const ref of scope.references) {
      const variable = ref.resolved;
      const range = ref.identifier.range;
      assert(range, "range is defined");
      for (const identifier of variable?.identifiers ?? []) {
        const replacement = importIdentifiers.get(identifier);
        if (replacement) {
          code.overwrite(range[0], range[1], replacement);
          code.addSourcemapLocation(range[0]);
          code.addSourcemapLocation(range[1]);
          break;
        }
      }
    }
  }
}
