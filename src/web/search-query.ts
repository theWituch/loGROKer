import {
  SyntaxError as LiqeSyntaxError,
  parse,
  test,
  type LiqeQuery,
  type ParserAst,
  type RegexExpressionToken,
} from 'liqe';
import type { LogRecord } from '../shared/contracts';

export interface LogQueryError {
  message: string;
  offset: number | null;
  line: number | null;
  column: number | null;
}

export type CompiledLogQuery =
  | { status: 'empty' }
  | { status: 'valid'; ast: LiqeQuery }
  | { status: 'invalid'; error: LogQueryError };

export type CellFilterMode = 'include' | 'exclude';

export function compileLogQuery(query: string): CompiledLogQuery {
  if (!query.trim()) {
    return { status: 'empty' };
  }

  try {
    const ast = parse(query);
    const regex = findRegexExpression(ast);
    if (regex) {
      return {
        status: 'invalid',
        error: {
          message: 'Regular expressions are not supported in this version. Use * or ? wildcards.',
          offset: regex.location.start,
          line: 1,
          column: regex.location.start + 1,
        },
      };
    }
    return { status: 'valid', ast };
  } catch (error) {
    if (error instanceof LiqeSyntaxError) {
      return {
        status: 'invalid',
        error: {
          message: `Syntax error at line ${error.line}, column ${error.column}.`,
          offset: error.offset,
          line: error.line,
          column: error.column,
        },
      };
    }
    return {
      status: 'invalid',
      error: {
        message: error instanceof Error
          ? `Unable to process query: ${error.message}`
          : 'Unable to process query.',
        offset: null,
        line: null,
        column: null,
      },
    };
  }
}

export function matchesLogQuery(query: CompiledLogQuery, record: LogRecord): boolean {
  if (query.status === 'empty') {
    return true;
  }
  if (query.status === 'invalid') {
    return false;
  }
  return test(query.ast, toSearchDocument(record));
}

export function appendCellFilter(
  query: string,
  field: string,
  value: string,
  mode: CellFilterMode,
): string | null {
  if (!field || !isFilterableCellValue(value)) return null;

  const compiled = compileLogQuery(query);
  if (compiled.status === 'invalid') return null;

  const tag = `${quoteLqlLiteral(field)}:${quoteLqlLiteral(value)}`;
  const condition = mode === 'exclude' ? `NOT ${tag}` : tag;
  if (compiled.status === 'empty') return condition;

  const current = query.trim();
  const requiresGrouping = compiled.ast.type === 'LogicalExpression'
    && compiled.ast.operator.type === 'BooleanOperator'
    && compiled.ast.operator.operator === 'OR';
  return `${requiresGrouping ? `(${current})` : current} AND ${condition}`;
}

export function isFilterableCellValue(value: string): boolean {
  return value.length > 0 && !/[\r\n]/u.test(value);
}

export function toSearchDocument(record: LogRecord): Record<string, string | number | boolean> {
  return {
    ...record.fields,
    raw: record.raw,
    _source: record.sourceName,
    _status: record.parseStatus,
    _sequence: record.sequence,
    _lines: record.lineCount,
    _multiline: record.multiline,
  };
}

function findRegexExpression(ast: ParserAst): RegexExpressionToken | null {
  if (ast.type === 'Tag') {
    return ast.expression.type === 'RegexExpression' ? ast.expression : null;
  }
  if (ast.type === 'LogicalExpression') {
    return findRegexExpression(ast.left) ?? findRegexExpression(ast.right);
  }
  if (ast.type === 'ParenthesizedExpression') {
    return findRegexExpression(ast.expression);
  }
  if (ast.type === 'UnaryOperator') {
    return findRegexExpression(ast.operand);
  }
  return null;
}

function quoteLqlLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
