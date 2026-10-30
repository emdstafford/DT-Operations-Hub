const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('lib/timecardSavedHours.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('exports', compiled)(mod.exports);
const { timecardSavedHours: hours } = mod.exports;
const entry = (changes = {}) => ({ contract: '3504W', employeeId: '00123', name: 'Brothers, Danny E', hundredths: 6150, ...changes });
test('matches contracts and IDs with different padding and case', () => {
  assert.equal(hours([entry()], '03504w', '123'), 6150);
});
test('totals all saved work rows for an employee', () => {
  assert.equal(hours([entry(), entry({ hundredths: 200 })], '03504W', '123'), 6350);
});
test('matches a unique full name when export ID schemes change', () => {
  assert.equal(hours([entry()], '03504W', 'ADP999', ' Brothers,  Danny E ', [entry({ employeeId: 'ADP999' })]), 6150);
});
test('does not merge employees with the same full name', () => {
  assert.equal(hours([entry(), entry({ employeeId: '456' })], '03504W', 'ADP999', 'Brothers, Danny E'), null);
  assert.equal(hours([entry()], '03504W', 'ADP999', 'Brothers, Danny E', [entry({ employeeId: 'ADP999' }), entry({ employeeId: 'ADP998' })]), null);
});
test('missing contract or employee is unknown, not zero', () => {
  assert.equal(hours([entry()], '035034'), null);
  assert.equal(hours([entry()], '03504W', '999', 'Other, Person'), null);
});
test('preserves actual recorded zero and does not mix contracts', () => {
  assert.equal(hours([entry({ hundredths: 0 })], '03504W', '123'), 0);
  assert.equal(hours([entry(), entry({ contract: '35034', hundredths: 1000 })], '03504W'), 6150);
});
