/* test_engine.js — Node 端引擎自测 */
const R = require('./engine.js');

function bench(label, fn) {
  const t0 = Date.now();
  const v = fn();
  console.log(`  ${label}: ${Date.now() - t0} ms`);
  return v;
}

console.log('=== 基础检查 ===');
const solved = R.solved();
console.log('  还原态判定 =', R.isSolved(solved));
// 每个转动 4 次还原
let bad = [];
for (const mv of R.MOVES) {
  let s = R.solved();
  for (let i = 0; i < 4; i++) s = R.applyMove(s, mv);
  if (!R.isSolved(s)) bad.push(mv);
}
console.log('  每个转动 4 次还原:', bad.length === 0 ? 'OK' : 'FAIL ' + bad);
// 阶数: (R U) = 105, (R U') = 63, sexy = 6
function order(seq) {
  let s = R.solved();
  for (let k = 1; k <= 500; k++) {
    for (const mv of seq) s = R.applyMove(s, mv);
    if (R.isSolved(s)) return k;
  }
  return null;
}
console.log('  阶数 (R U) =', order(['R', 'U']), " (R U') =", order(['R', "U'"]),
  ' sexy =', order(['R', 'U', "R'", "U'"]));
// T-perm 应该只动 2 角 2 棱
let t = R.solved();
for (const mv of R.TPERM) t = R.applyMove(t, mv);
const movedC = t.cp.filter((c, i) => c !== i || t.co[i] !== 0).length;
const movedE = t.ep.filter((c, i) => c !== i || t.eo[i] !== 0).length;
console.log(`  T-perm 动到角 ${movedC} / 棱 ${movedE} (应为 2/2), 两桥保持 = ${R.blocksSolved(t)}`);

console.log('\n=== 取色检查 (还原态每个面应同色) ===');
for (const f of ['U', 'D', 'F', 'B', 'R', 'L']) {
  const c = R.faceColors(solved, f);
  console.log(`  ${f} 面: ${c.join(',')}  单一颜色 = ${new Set(c).size === 1}`);
}

console.log('\n=== 单例全流程 ===');
const scr = R.randomScramble(25, (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })());
console.log('  打乱:', scr.join(' '));
const plan = bench('buildPlan', () => R.buildPlan(scr));
for (const st of plan.stages) {
  console.log(`  ${st.title}: ${st.steps.length} 个步骤, ` +
    st.steps.map((x) => `${x.name}[${x.moves.join(' ')}]`).join(' | '));
}
console.log('  总步数 =', plan.totalMoves, ' 最终还原 =', R.isSolved((() => {
  let s = plan.scrambleState;
  for (const st of plan.stages) for (const step of st.steps) s = R.applyAlg(s, step.moves);
  return s;
})()));

console.log('\n=== 随机 60 例全流程自测 ===');
const res = bench('selfTest(60)', () => R.selfTest(60, 12345));
console.log(' ', JSON.stringify(res, null, 2));
