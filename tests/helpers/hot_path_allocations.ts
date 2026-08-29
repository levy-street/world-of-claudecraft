import ts from 'typescript';

export interface HotPathSource {
  readonly fileName: string;
  readonly source: string;
}

export interface HotPathAllocationScan {
  readonly visited: readonly string[];
  readonly allocations: readonly string[];
  readonly unresolvedCalls: readonly string[];
}

type Callable = ts.FunctionDeclaration | ts.MethodDeclaration;

const ALLOCATING_GLOBAL_CALLS = new Set(['structuredClone']);

const ALLOCATING_STATIC_CALLS = new Set([
  'Array.from',
  'Array.of',
  'JSON.parse',
  'JSON.stringify',
  'Object.assign',
  'Object.create',
  'Object.entries',
  'Object.fromEntries',
  'Object.keys',
  'Object.values',
]);

const ALLOCATING_METHOD_CALLS = new Set([
  'concat',
  'filter',
  'flat',
  'flatMap',
  'map',
  'match',
  'matchAll',
  'reduce',
  'replace',
  'replaceAll',
  'slice',
  'splice',
  'split',
  'toReversed',
  'toSorted',
  'with',
]);

const SAFE_EXTERNAL_CALLS = new Set([
  'Math.max',
  'Math.min',
  'Object.hasOwn',
  'ctx.arc',
  'ctx.beginPath',
  'ctx.closePath',
  'ctx.fill',
  'ctx.lineTo',
  'ctx.moveTo',
  'ctx.quadraticCurveTo',
  'ctx.rect',
  'ctx.stroke',
]);

function callableName(node: Callable): string | null {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
}

function directCalleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return expr.name.text;
  }
  return null;
}

function staticCalleeName(expr: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return null;
  return `${expr.expression.text}.${expr.name.text}`;
}

function allocationLabel(node: ts.Node): string | null {
  if (ts.isNewExpression(node)) return 'new expression';
  if (ts.isObjectLiteralExpression(node)) return 'object literal';
  if (ts.isArrayLiteralExpression(node)) return 'array literal';
  if (ts.isArrowFunction(node)) return 'arrow function';
  if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return 'function closure';
  if (ts.isClassExpression(node)) return 'class expression';
  if (ts.isTemplateExpression(node) || ts.isTaggedTemplateExpression(node)) {
    return 'template expression';
  }
  if (ts.isRegularExpressionLiteral(node)) return 'regular expression literal';
  if (ts.isSpreadElement(node) || node.kind === ts.SyntaxKind.SpreadAssignment) {
    return 'spread expression';
  }
  if (!ts.isCallExpression(node)) return null;

  if (ts.isIdentifier(node.expression) && ALLOCATING_GLOBAL_CALLS.has(node.expression.text)) {
    return `${node.expression.text} call`;
  }
  const staticName = staticCalleeName(node.expression);
  if (staticName && ALLOCATING_STATIC_CALLS.has(staticName)) return `${staticName} call`;
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ALLOCATING_METHOD_CALLS.has(node.expression.name.text)
  ) {
    return `.${node.expression.name.text} call`;
  }
  return null;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const snippet = node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
  return `${sourceFile.fileName}:${line}: ${snippet}`;
}

/**
 * Walk named functions and class methods reachable from the supplied roots.
 *
 * Module-scope tables are intentionally outside the scan: they allocate once at
 * import time. Every expression inside a reachable body is checked, and a direct
 * call to a named helper extends the walk. A newly imported or renamed bare helper
 * is reported as unresolved instead of silently escaping the gate.
 */
export function scanReachableHotPath(
  sources: readonly HotPathSource[],
  roots: readonly string[],
): HotPathAllocationScan {
  const declarations = new Map<string, Array<{ callable: Callable; sourceFile: ts.SourceFile }>>();
  for (const input of sources) {
    const sourceFile = ts.createSourceFile(
      input.fileName,
      input.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const collect = (node: ts.Node): void => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body) {
        const name = callableName(node);
        if (name) {
          const entries = declarations.get(name) ?? [];
          entries.push({ callable: node, sourceFile });
          declarations.set(name, entries);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }

  const queue = [...roots];
  const visited = new Set<string>();
  const allocations: string[] = [];
  const unresolvedCalls: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const matches = declarations.get(name) ?? [];
    if (matches.length !== 1) {
      unresolvedCalls.push(`${name}: expected one declaration, found ${matches.length}`);
      continue;
    }
    const { callable, sourceFile } = matches[0];
    const body = callable.body;
    if (!body) {
      unresolvedCalls.push(`${name}: declaration has no body`);
      continue;
    }
    const visit = (node: ts.Node): void => {
      const allocation = allocationLabel(node);
      if (allocation) allocations.push(`${name}: ${allocation} at ${location(sourceFile, node)}`);
      if (ts.isCallExpression(node)) {
        const callee = directCalleeName(node.expression);
        if (callee && !ALLOCATING_GLOBAL_CALLS.has(callee)) {
          if (declarations.has(callee)) queue.push(callee);
          else
            unresolvedCalls.push(`${name}: unresolved ${callee} at ${location(sourceFile, node)}`);
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const staticName = staticCalleeName(node.expression);
          const allocatingMethod = ALLOCATING_METHOD_CALLS.has(node.expression.name.text);
          if (
            !allocatingMethod &&
            (!staticName ||
              (!ALLOCATING_STATIC_CALLS.has(staticName) && !SAFE_EXTERNAL_CALLS.has(staticName)))
          ) {
            unresolvedCalls.push(
              `${name}: unresolved ${node.expression.getText(sourceFile)} at ${location(sourceFile, node)}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }

  return {
    visited: [...visited].sort(),
    allocations: allocations.sort(),
    unresolvedCalls: unresolvedCalls.sort(),
  };
}
