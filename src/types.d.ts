declare module "escope" {
  import * as estree from "estree";

  // Manual typings based on the JSDocs here: https://estools.github.io/escope/module-escope.html

  function analyze(
    tree: estree.Node,
    options: {
      optimistic?: boolean;
      directive?: boolean;
      ignoreEval?: boolean;
      sourceType?: "script" | "module";
      ecmaVersion: number;
    }
  ): ScopeManager;

  class ScopeManager {
    scopes: Scope[];
  }

  class Scope {
    /** A reference to the scope-defining syntax node.  */
    block: estree.Node;
    childScopes: Scope[];
    /** Whether this is a scope that contains an 'eval()' invocation.  */
    directCallToEvalScope: boolean;
    /** Generally, through the lexical scoping of JS you can always know which variable an identifier
     * in the source code refers to. There are a few exceptions to this rule. With 'global' and 'with'
     * scopes you can only decide at runtime which variable a reference refers to. Moreover, if 'eval()'
     * is used in a scope, it might introduce new bindings in this or its prarent scopes. All those scopes
     * are considered 'dynamic'.  */
    dynamic: boolean;
    functionExpressionScope: boolean;
    isStrict: boolean;

    references: Reference[];

    set: Map<string, Variable>;

    taints: Map<string, Variable>;

    thisFound: boolean;

    /** The references that are not resolved with this scope */
    through: Reference[];
    type: "catch" | "with" | "function" | "global" | "block";
    /** The parent scope */
    upper: Scope;
    /** The scoped Variables of this scope. In the case of a 'function' scope this includes the automatic
     * argument arguments as its first element, as well as all further formal arguments. */
    variables: Variable[];
    /** For 'global' and 'function' scopes, this is a self-reference. For other scope types this is the
     * variableScope value of the parent scope. */
    variableScope: Scope;
  }

  class Reference {
    from: Scope;
    identifier: estree.Identifier;
    /** Whether the Reference might refer to a partial value of writeExpr */
    partial: boolean;
    resolved: Variable | null;
    /** Whether the reference comes from a dynamic scope (such as 'eval', 'with', etc.), and may be trapped by dynamic scopes */
    tainted: boolean;
    /** If reference is writeable, this is the tree being written to it.  */
    writeExpr: estree.Node;
  };

  class Variable {
    /** List of defining occurrences of this variable (like in 'var ...' statements or as parameter), as custom objects.  */
    defs: {type: string; name: estree.Identifier; node: estree.Node; parent: estree.Node}[];
    /** List of defining occurrences of this variable (like in 'var ...' statements or as parameter), as AST nodes.  */
    identifiers: estree.Identifier[];
    name: string;
    /** List of references of this variable (excluding parameter entries) in its defining scope and all nested scopes. For defining occurrences only see Variable#defs.  */
    references: Reference[];
    scope: Scope;
    stack: boolean;
    tainted: boolean;
  }
}
