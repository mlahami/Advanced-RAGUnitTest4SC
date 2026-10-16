// Strict syntax parsers; failures are returned to Python, never silently repaired.
const fs = require('fs');
const {createRequire} = require('module');
const loader = process.env.AR_PARSER_PACKAGE ? createRequire(process.env.AR_PARSER_PACKAGE) : require;
const solidity = loader('@solidity-parser/parser');
const babel = loader('@babel/parser');
function parse(item) {
  const text = item.text;
  const units = [];
  const cp = offset => Array.from(text.slice(0, offset)).length;
  function add(type, name, start, end, extra={}) {
    units.push({type,name,start:cp(start),end:cp(end),...extra});
  }
  try {
    if (item.language === 'solidity') {
      const ast = solidity.parse(text, {range:true, tolerant:false});
      const kinds = {ContractDefinition:'contract', FunctionDefinition:'function',
        ModifierDefinition:'modifier', EventDefinition:'event', CustomErrorDefinition:'error'};
      function walk(node, owner=null) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'ContractDefinition') owner = node.name;
        if (kinds[node.type] && node.range) {
          const name = node.name || (node.isConstructor ? 'constructor' : node.isReceiveEther ? 'receive' : 'fallback');
          add(kinds[node.type], name, node.range[0], node.range[1]+1, {contract_name:owner,
            declaration_kind:node.kind || node.type,
            modifiers:(node.modifiers || []).map(m=>m.name)});
        }
        for (const [key,value] of Object.entries(node)) {
          if (['range','loc','errors'].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(x=>walk(x, owner));
          else if (value && typeof value === 'object') walk(value, owner);
        }
      }
      walk(ast);
    } else {
      const ast = babel.parse(text, {sourceType:'unambiguous', errorRecovery:false});
      function calleeName(node) {
        if (node?.type === 'Identifier') return node.name;
        if (node?.type === 'MemberExpression') return calleeName(node.object)+'.'+(node.property.name || node.property.value);
        return '';
      }
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression') {
          const call = calleeName(node.callee);
          const root = call.split('.')[0];
          const kind = ['describe','context','contract','suite'].includes(root) ? 'test_suite' : ['it','test','specify'].includes(root) ? 'test_case' : null;
          if (kind && !call.endsWith('.each')) {
            const first = node.arguments[0];
            const name = first?.type === 'StringLiteral' ? first.value : text.slice(first?.start || node.start, first?.end || node.start);
            add(kind, name, node.start, node.end, {call});
          }
        }
        for (const [key,value] of Object.entries(node)) {
          if (['loc','start','end','comments','tokens'].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === 'object') walk(value);
        }
      }
      walk(ast);
    }
    return {id:item.id,status:'ast',units};
  } catch (error) {
    return {id:item.id,status:'parse_failed',units:[],error:String(error.message).slice(0,400)};
  }
}
const input = JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(input.map(parse)));
