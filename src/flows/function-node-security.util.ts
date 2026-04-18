import { AnyNode, parse } from 'acorn';
import * as walk from 'acorn-walk';

export type FunctionNodeValidationConfig = {
  maxCodeLength?: number;
  maxAstNodes?: number;
};

export const DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH = 2000;
export const DEFAULT_FUNCTION_NODE_MAX_AST_NODES = 300;

const ALLOWED_GLOBALS = new Set([
  'msg',
  'mapValue',
  'Number',
  'Math',
  'parseInt',
  'parseFloat',
  'isNaN',
  'Boolean',
  'String',
  'Date',
  'JSON',
  'Infinity',
  'NaN',
  'undefined',
]);

const FORBIDDEN_IDENTIFIERS = new Set([
  'process',
  'global',
  'globalThis',
  'constructor',
  '__proto__',
  'prototype',
]);

const FORBIDDEN_CALLS = new Set([
  'require',
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
]);

const FORBIDDEN_MEMBER_PROPERTIES = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function collectDeclaredIdentifiers(
  node: AnyNode | null | undefined,
  declared: Set<string>
) {
  if (!node) return;

  if (node.type === 'Identifier') {
    declared.add(node.name);
    return;
  }

  if (node.type === 'RestElement') {
    collectDeclaredIdentifiers(node.argument as AnyNode, declared);
    return;
  }

  if (node.type === 'AssignmentPattern') {
    collectDeclaredIdentifiers(node.left as AnyNode, declared);
    return;
  }

  if (node.type === 'ArrayPattern') {
    for (const element of node.elements) {
      collectDeclaredIdentifiers(element as AnyNode, declared);
    }
    return;
  }

  if (node.type === 'ObjectPattern') {
    for (const property of node.properties) {
      if (property.type === 'Property') {
        collectDeclaredIdentifiers(property.value as AnyNode, declared);
      } else if (property.type === 'RestElement') {
        collectDeclaredIdentifiers(property.argument as AnyNode, declared);
      }
    }
  }
}

function getMemberPropertyName(node: AnyNode): string | null {
  if (node.type !== 'MemberExpression') return null;

  const property = node.property as AnyNode;
  if (!node.computed && property?.type === 'Identifier') {
    return property.name;
  }

  if (node.computed && property?.type === 'Literal') {
    return typeof property.value === 'string' ? property.value : null;
  }

  return null;
}

function isIdentifierReference(node: AnyNode, parent?: AnyNode): boolean {
  if (!parent) return true;

  if (
    parent.type === 'MemberExpression' &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }

  if (
    parent.type === 'Property' &&
    parent.key === node &&
    !parent.computed &&
    !parent.shorthand
  ) {
    return false;
  }

  if (parent.type === 'MethodDefinition' && parent.key === node) {
    return false;
  }

  if (parent.type === 'VariableDeclarator' && parent.id === node) {
    return false;
  }

  if (
    (parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression') &&
    (parent.id === node || (parent.params as AnyNode[]).includes(node))
  ) {
    return false;
  }

  if (parent.type === 'LabeledStatement' && parent.label === node) {
    return false;
  }

  if (
    (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') &&
    parent.label === node
  ) {
    return false;
  }

  if (parent.type === 'CatchClause' && parent.param === node) {
    return false;
  }

  return true;
}

function readOption(
  value: number | undefined,
  fallback: number,
  minValue = 1
): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  if (normalized < minValue) return fallback;
  return normalized;
}

export function validateFunctionNodeCode(
  codeRaw: unknown,
  config?: FunctionNodeValidationConfig
): string | null {
  if (typeof codeRaw !== 'string') {
    return 'Code must be a string';
  }

  const code = codeRaw.trim();
  if (!code) {
    return null;
  }

  const maxCodeLength = readOption(
    config?.maxCodeLength,
    DEFAULT_FUNCTION_NODE_MAX_CODE_LENGTH
  );
  const maxAstNodes = readOption(
    config?.maxAstNodes,
    DEFAULT_FUNCTION_NODE_MAX_AST_NODES
  );

  if (code.length > maxCodeLength) {
    return `Code exceeds the maximum length (${maxCodeLength} characters)`;
  }

  try {
    const ast = parse(`(function(msg) { ${code}\n})`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: false,
    });

    const errors: string[] = [];
    let hasReturn = false;
    let astNodeCount = 0;

    const declared = new Set<string>(['msg']);
    const used = new Set<string>();

    walk.fullAncestor(ast, (node: AnyNode, ancestors: AnyNode[]) => {
      if (errors.length) return;

      astNodeCount++;
      if (astNodeCount > maxAstNodes) {
        errors.push(`Code is too complex (max ${maxAstNodes} AST nodes)`);
        return;
      }

      const parent = ancestors[ancestors.length - 2] as AnyNode | undefined;

      if (node.type === 'ReturnStatement') {
        hasReturn = true;
      }

      if (
        node.type === 'ForStatement' ||
        node.type === 'ForInStatement' ||
        node.type === 'ForOfStatement' ||
        node.type === 'WhileStatement' ||
        node.type === 'DoWhileStatement'
      ) {
        errors.push('Loops are not allowed');
        return;
      }

      if (node.type === 'TryStatement') {
        errors.push('try/catch is not allowed');
        return;
      }

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        const isWrapperFunction =
          node.type === 'FunctionExpression' &&
          parent?.type === 'ExpressionStatement' &&
          ancestors.length >= 2 &&
          ancestors[ancestors.length - 3]?.type === 'Program';

        if (!isWrapperFunction) {
          errors.push('Defining functions is not allowed');
          return;
        }
      }

      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        errors.push('Classes are not allowed');
        return;
      }

      if (node.type === 'ImportExpression') {
        errors.push('Dynamic import is not allowed');
        return;
      }

      if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') {
        errors.push('Async and generator syntax is not allowed');
        return;
      }

      if (node.type === 'ThisExpression') {
        errors.push('this is not allowed');
        return;
      }

      if (node.type === 'NewExpression') {
        errors.push('new expressions are not allowed');
        return;
      }

      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        FORBIDDEN_CALLS.has(node.callee.name)
      ) {
        errors.push(`${node.callee.name}() is not allowed`);
        return;
      }

      if (
        node.type === 'MemberExpression' &&
        FORBIDDEN_MEMBER_PROPERTIES.has(getMemberPropertyName(node) ?? '')
      ) {
        errors.push('Access to prototype chain properties is not allowed');
        return;
      }

      if (node.type === 'VariableDeclarator') {
        collectDeclaredIdentifiers(node.id as AnyNode, declared);
      }

      if (node.type !== 'Identifier') {
        return;
      }

      if (!isIdentifierReference(node, parent)) {
        return;
      }

      if (FORBIDDEN_IDENTIFIERS.has(node.name)) {
        errors.push(`${node.name} is not allowed`);
        return;
      }

      used.add(node.name);
    });

    if (errors.length) {
      return errors[0];
    }

    for (const name of used) {
      if (!declared.has(name) && !ALLOWED_GLOBALS.has(name)) {
        return `'${name}' is not defined`;
      }
    }

    if (!hasReturn) {
      return 'Code must have a return value';
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Syntax error: ${message}`;
  }
}
