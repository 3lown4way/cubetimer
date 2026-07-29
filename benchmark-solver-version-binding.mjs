import fs from 'node:fs';

const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const declaration = /const solverVersion = VALID_SOLVER_VERSIONS\.has\(appState\.settings\.solverVersion\)[\s\S]*?: "v2";/;
const dispatch = /solverApi\.solve\(\{[\s\S]*?solverVersion,/;

if (!declaration.test(main)) {
  throw new Error('SOLVER_VERSION_DECLARATION_MISSING');
}
if (!dispatch.test(main)) {
  throw new Error('SOLVER_VERSION_DISPATCH_MISSING');
}
console.log('solverVersion binding regression check passed');
