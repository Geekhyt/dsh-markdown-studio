import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
export interface Position {
  line: number;
  column: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface CoverageFile {
  path: string;
  fnMap: Record<string, { name: string; decl: Range; loc: Range }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc: Range }>;
  b: Record<string, number[]>;
  statementMap: Record<string, Range>;
  s: Record<string, number>;
}
export interface FunctionNode {
  node: ts.FunctionLikeDeclaration;
  start: number;
  end: number;
  name: string;
  line: number;
}
export function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionLike(node) && 'body' in node && !!node.body;
}
export function functionsIn(source: ts.SourceFile): FunctionNode[] {
  const result: FunctionNode[] = [];
  function visit(node: ts.Node): void {
    if (isFunction(node)) {
      const start = node.getStart(source);
      result.push({
        node,
        start,
        end: node.end,
        name: node.name?.getText(source) || '<anonymous>',
        line: source.getLineAndCharacterOfPosition(start).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
export function complexity(node: ts.FunctionLikeDeclaration): number {
  let total = 1;
  function visit(child: ts.Node): void {
    if (child !== node && isFunction(child)) return;
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCaseClause(child) ||
      ts.isCatchClause(child) ||
      ts.isConditionalExpression(child)
    )
      total++;
    if (
      ts.isBinaryExpression(child) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        child.operatorToken.kind,
      )
    )
      total++;
    ts.forEachChild(child, visit);
  }
  if (node.body) visit(node.body);
  return total;
}
export function ownerAt(
  functions: FunctionNode[],
  source: ts.SourceFile,
  position: Position,
): FunctionNode | undefined {
  const starts = source.getLineStarts();
  const line = Math.min(Math.max(0, position.line - 1), starts.length - 1);
  let offset = Math.min(starts[line] + position.column, (starts[line + 1] ?? source.end) - 1);
  while (offset < source.end && /\s/.test(source.text[offset])) offset++;
  return functions
    .filter((fn) => fn.start <= offset && offset < fn.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}
function hasRuntime(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement))
    return false;
  if (
    ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
  )
    return false;
  if (ts.isImportDeclaration(statement)) return !statement.importClause?.isTypeOnly;
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  return true;
}
export function runtimeSources(root: string): string[] {
  const walk = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const name = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(name) : [name];
    });
  return [...walk(path.join(root, 'src')), ...walk(path.join(root, 'host')), path.join(root, 'index.ts')]
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .filter((file) =>
      ts
        .createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
        .statements.some(hasRuntime),
    );
}
