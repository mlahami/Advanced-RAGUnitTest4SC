// Strict parsers for corpus v2 source blocks. Offsets are UTF-16 code units converted to code points.
// Solidity: contracts, functions, modifiers, events, errors. JavaScript: suites, cases, hooks, and
// the declarations at program and suite scope that a test case may need as setup.
const fs = require('fs');
const {createRequire} = require('module');
const loader = process.env.AR_PARSER_PACKAGE ? createRequire(process.env.AR_PARSER_PACKAGE) : require;
const solidity = loader('@solidity-parser/parser');
const babel = loader('@babel/parser');

const SUITES = ['describe', 'context', 'suite'];
const CASES = ['it', 'test', 'specify'];
const HOOKS = ['before', 'beforeEach', 'after', 'afterEach', 'beforeAll', 'afterAll'];

function calleeName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression') return calleeName(node.object) + '.' + (node.property.name || node.property.value);
  return '';
}

function patternNames(node, out = []) {
  if (!node) return out;
  if (node.type === 'Identifier') out.push(node.name);
  else if (node.type === 'ObjectPattern') node.properties.forEach(p => patternNames(p.type === 'RestElement' ? p.argument : p.value, out));
  else if (node.type === 'ArrayPattern') node.elements.forEach(e => patternNames(e, out));
  else if (node.type === 'AssignmentPattern') patternNames(node.left, out);
  else if (node.type === 'RestElement') patternNames(node.argument, out);
  return out;
}

function parse(item) {
  const text = item.text;
  const cp = offset => Array.from(text.slice(0, offset)).length;
  const units = [];
  const add = (type, name, start, end, extra = {}) => units.push({type, name, start: cp(start), end: cp(end), ...extra});
  try {
    if (item.language === 'solidity') {
      const ast = solidity.parse(text, {range: true, tolerant: false});
      const kinds = {FunctionDefinition: 'function', ModifierDefinition: 'modifier',
        EventDefinition: 'event', CustomErrorDefinition: 'error'};
      (function walk(node, owner) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'ContractDefinition') {
          owner = node.name;
          add('contract', node.name, node.range[0], node.range[1] + 1, {contract_kind: node.kind});
        } else if (kinds[node.type] && node.range) {
          const name = node.name || (node.isConstructor ? 'constructor' : node.isReceiveEther ? 'receive' : 'fallback');
          add(kinds[node.type], name, node.range[0], node.range[1] + 1, {contract_name: owner,
            visibility: node.visibility || null, state_mutability: node.stateMutability || null,
            modifiers: (node.modifiers || []).map(m => m.name), has_body: Boolean(node.body)});
        }
        for (const [key, value] of Object.entries(node)) {
          if (['range', 'loc', 'errors'].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(x => walk(x, owner));
          else if (value && typeof value === 'object') walk(value, owner);
        }
      })(ast, null);
    } else {
      const ast = babel.parse(text, {sourceType: 'unambiguous', errorRecovery: false});
      let counter = 0;
      // Declarations are the direct statements of the program or of a suite callback body.
      function declarations(statements, scope) {
        for (const statement of statements) {
          const call = statement.type === 'ExpressionStatement' && statement.expression.type === 'CallExpression'
            ? calleeName(statement.expression.callee).split('.')[0] : '';
          if ([...SUITES, ...CASES, ...HOOKS].includes(call)) continue;
          let names = [];
          if (statement.type === 'VariableDeclaration') statement.declarations.forEach(d => patternNames(d.id, names));
          else if (statement.type === 'FunctionDeclaration' && statement.id) names = [statement.id.name];
          add('declaration', names.join(',') || statement.type, statement.start, statement.end, {scope, names,
            statement_type: statement.type});
        }
      }
      function suiteBody(node) {
        const callback = node.arguments.find(a => ['FunctionExpression', 'ArrowFunctionExpression'].includes(a.type));
        return callback && callback.body.type === 'BlockStatement' ? callback.body.body : null;
      }
      function walk(node, suite) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression') {
          const call = calleeName(node.callee);
          const root = call.split('.')[0];
          const first = node.arguments[0];
          const title = first?.type === 'StringLiteral' ? first.value
            : first?.type === 'TemplateLiteral' ? text.slice(first.start + 1, first.end - 1) : null;
          if (SUITES.includes(root) && !call.endsWith('.each')) {
            const id = 's' + (counter++);
            add('test_suite', title ?? '<dynamic title>', node.start, node.end, {suite_id: id, parent_suite: suite, call});
            const body = suiteBody(node);
            if (body) declarations(body, id);
            node.arguments.forEach(a => walk(a, id));
            return;
          }
          if (CASES.includes(root) && !call.endsWith('.each')) {
            add('test_case', title ?? '<dynamic title>', node.start, node.end, {parent_suite: suite, call});
            return;
          }
          if (HOOKS.includes(root)) {
            add('hook', root, node.start, node.end, {parent_suite: suite, call});
            return;
          }
        }
        for (const [key, value] of Object.entries(node)) {
          if (['loc', 'start', 'end', 'comments', 'tokens', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(v => walk(v, suite));
          else if (value && typeof value === 'object') walk(value, suite);
        }
      }
      declarations(ast.program.body, null);
      walk(ast.program, null);
    }
    return {id: item.id, status: 'ast', units};
  } catch (error) {
    return {id: item.id, status: 'parse_failed', units: [], error: String(error.message).slice(0, 400)};
  }
}

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(input.map(parse)));
