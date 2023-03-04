import * as acorn from "acorn";
import * as walk from "acorn-walk";
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
  const originalCode = code.toString();

  context.time("replaceImports::acorn");
  const ast = acorn.parse(code.original, {
    sourceType: "module",
    ecmaVersion: 2020,
    ranges: true,
    allowReturnOutsideFunction: true,
    locations: true,
  }) as estree.Node & acorn.Node;
  context.timeEnd("replaceImports::acorn");

  context.time("replaceImports::parents");
  const parents = new WeakMap<acorn.Node, acorn.Node>();
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    parents.set(node, ancestors[ancestors.length - 2]);
  });
  context.timeEnd("replaceImports::parents");

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
          const parent = parents.get(
            ref.identifier as unknown as acorn.Node
          ) as estree.Node;
          if (parent?.type === "Property" && parent.shorthand) {
            code.appendRight(range[1], `: ${replacement}`);
            code.addSourcemapLocation(range[1]);
          } else {
            code.overwrite(range[0], range[1], replacement);
            code.addSourcemapLocation(range[0]);
            code.addSourcemapLocation(range[1]);
          }
          break;
        }
      }
    }
  }
}
