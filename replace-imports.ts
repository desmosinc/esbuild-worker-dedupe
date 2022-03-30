import * as acorn from "acorn";
import * as escope from "escope";
import * as estree from "estree";
import { applyChanges, Change } from "./apply-changes";
import { assert } from "./assert";

export function replaceImports(code: string, getExportsObjectName: (i: estree.ImportDeclaration) => string | false) {
  const ast = acorn.parse(code, {
    sourceType: "module",
    ecmaVersion: 2020,
    ranges: true,
    allowReturnOutsideFunction: true,
    locations: true
  }) as estree.Node & acorn.Node;

  const changes: Change[] = [];

  assert(ast.type === "Program", `Unexpected top-level node ${ast.type}`);
  const imports = ast.body.filter(
    (n): n is estree.ImportDeclaration => n.type === "ImportDeclaration"
  );
  const importIdentifiers = new Map<estree.Identifier, string>();
  for (const declaration of imports) {
    const exportsObject = getExportsObjectName(declaration);
    if (exportsObject) {
      assert(declaration.range, 'range');
      changes.push({
        range: declaration.range,
        replacement: ''
      })
      for (const spec of declaration.specifiers) {
        importIdentifiers.set(spec.local, exportsObject);
      }
    }

  }

  const manager = escope.analyze(ast, {
    optimistic: true,
    sourceType: "module",
    ecmaVersion: 11,
  });

  for (const scope of manager.scopes) {
    for (const ref of scope.references) {
      const variable = ref.resolved;
      for (const identifier of variable?.identifiers ?? []) {
        const exports = importIdentifiers.get(identifier);
        if (exports) {
          const range = ref.identifier.range;
          assert(range, 'range is defined');
          changes.push({
            range,
            replacement: `${exports}['${identifier.name}']`
          })
        }
      }
    }
  }

  return applyChanges(code, changes);
}
