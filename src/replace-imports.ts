import * as acorn from "acorn";
import * as escope from "escope";
import * as estree from "estree";
import { applyChanges, Change } from "./apply-changes";
import { assert } from "./assert";

export function replaceImports(
  code: string,
  getExportsObjectName: (i: estree.ImportDeclaration) => string | false
) {
  console.time("replaceImports::acorn");
  const ast = acorn.parse(code, {
    sourceType: "module",
    ecmaVersion: 2020,
    ranges: true,
    allowReturnOutsideFunction: true,
    locations: true,
  }) as estree.Node & acorn.Node;
  console.timeEnd("replaceImports::acorn");

  const changes: Change[] = [];

  assert(ast.type === "Program", `Unexpected top-level node ${ast.type}`);
  const imports = ast.body.filter(
    (n): n is estree.ImportDeclaration => n.type === "ImportDeclaration"
  );
  const importIdentifiers = new Map<estree.Identifier, string>();
  for (const declaration of imports) {
    const exportsObjectName = getExportsObjectName(declaration);
    if (exportsObjectName) {
      assert(declaration.range, "range");
      changes.push({
        range: declaration.range,
        replacement: "",
      });

      for (const spec of declaration.specifiers) {
        const replacement = spec.type === 'ImportNamespaceSpecifier' ? exportsObjectName :
          spec.type === 'ImportDefaultSpecifier' ? `${exportsObjectName}.default` :
          `${exportsObjectName}['${spec.imported.name}']`

        importIdentifiers.set(spec.local, replacement);
      }
    }
  }

  console.time("replaceImports::escope");
  const manager = escope.analyze(ast, {
    optimistic: true,
    sourceType: "module",
    ecmaVersion: 11,
  });
  console.timeEnd("replaceImports::escope");

  for (const scope of manager.scopes) {
    for (const ref of scope.references) {
      const variable = ref.resolved;
      const range = ref.identifier.range;
      assert(range, "range is defined");
      for (const identifier of variable?.identifiers ?? []) {
        const replacement = importIdentifiers.get(identifier);
        if (replacement) {
          changes.push({
            range,
            replacement,
          });
          break;
        }
      }
    }
  }

  return applyChanges(code, changes);
}
