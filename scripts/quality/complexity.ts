import ts from "typescript";

interface FunctionComplexity {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
}

const isFunctionLikeNode = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);

const getFunctionName = (node: ts.FunctionLikeDeclaration) => {
  if ("name" in node && node.name) {
    return node.name.getText();
  }

  const parent = node.parent;

  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  if (ts.isPropertyAssignment(parent)) {
    return parent.name.getText();
  }

  return "<anonymous>";
};

const contributesDecision = (node: ts.Node) => {
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node)
  ) {
    return true;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return true;
  }

  return false;
};

const getLineNumber = (sourceFile: ts.SourceFile, position: number) =>
  sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const calculateComplexity = (node: ts.FunctionLikeDeclaration) => {
  let complexity = 1;

  const visit = (child: ts.Node) => {
    if (child !== node && isFunctionLikeNode(child)) {
      return;
    }

    if (contributesDecision(child)) {
      complexity++;
    }

    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return complexity;
};

export const getFunctionComplexities = (
  filePath: string,
  sourceText: string
): FunctionComplexity[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const functions: FunctionComplexity[] = [];

  const visit = (node: ts.Node) => {
    if (isFunctionLikeNode(node)) {
      functions.push({
        name: getFunctionName(node),
        startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
        endLine: getLineNumber(sourceFile, node.getEnd()),
        complexity: calculateComplexity(node),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
};
