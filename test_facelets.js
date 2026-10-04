/* test_facelets.js — 状态导入/导出/校验 自测 */
const R = require('./engine.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ❌', msg); } };

// 1. 24 个持法
const rots = R._internals.ROTATIONS_24 || null;
console.log('=== 持法与配色 ===');
ok(R.setOrientationByColors(1, 4), '黄顶红前 应可设定');
ok(R.getOrientation().map.U === 1 && R.getOrientation().map.F === 4, 'U=黄, F=红');
ok(R.getOrientation().map.R === 2 && R.getOrientation().map.L === 3, 'R=绿, L=蓝（左右桥=蓝/绿）');
ok(!R.setOrientationByColors(0, 1), '白顶 + 黄前（相对色）应被拒绝');
let n = 0;
for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (R.setOrientationByColors(a, b)) n++;
ok(n === 24, `合法持法应为 24 种，实际 ${n}`);
R.setOrientationByColors(1, 4);
console.log('  当前朝向:', R.orientationLabel());

// 2. 导出/导入往返
console.log('\n=== 导入/导出往返 (300 例随机打乱) ===');
let rt = 0;
for (let i = 0; i < 300; i++) {
  const scr = R.randomScramble(22);
  const st = R.applyAlg(R.solved(), scr);
  const fl = R.faceletsFromState(st);
  const back = R.stateFromFacelets(fl);
  if (back.state && R.encode(back.state) === R.encode(st)) rt++;
  else { console.log('  ❌ 往返失败:', scr.join(' '), back.errors); break; }
}
ok(rt === 300, `往返成功 ${rt}/300`);
console.log(`  还原态的 net 串 = ${R.faceletsToString(R.faceletsFromState(R.solved()))}`);
console.log(`  (顺序: ${R.NET_FACES.join(' ')} 每面 9 格)`);

// 3. 任意状态直接求解
console.log('\n=== 从导入状态直接出方案 ===');
let solvedAll = 0;
for (let i = 0; i < 40; i++) {
  const scr = R.randomScramble(22);
  const st = R.applyAlg(R.solved(), scr);
  const fl = R.faceletsFromState(st);
  const parsed = R.stateFromFacelets(fl);
  if (!parsed.state) { console.log('  ❌ 解析失败', parsed.errors); break; }
  const plan = R.buildPlanFromState(parsed.state, { scrambleMoves: scr });
  let s = plan.scrambleState;
  for (const stage of plan.stages) for (const step of stage.steps) s = R.applyAlg(s, step.moves);
  if (R.isSolved(s)) solvedAll++;
  else { console.log('  ❌ 未还原:', scr.join(' ')); break; }
}
ok(solvedAll === 40, `导入状态求解成功 ${solvedAll}/40`);

// 4. 错误输入的检出
console.log('\n=== 错误输入检出 ===');
const good = R.faceletsFromState(R.applyAlg(R.solved(), ['R', 'U', "F'"]));
const bad1 = good.slice(); bad1[0] = (bad1[0] + 1) % 6;
const r1 = R.stateFromFacelets(bad1);
ok(r1.errors.length > 0, '改一个贴纸应报错');
console.log('   改 1 格 ->', r1.errors[0]);
const bad2 = good.slice(); const t = bad2[0]; bad2[0] = bad2[18]; bad2[18] = t;   // 不同色的两格对调
const r2 = R.stateFromFacelets(bad2);
ok(r2.errors.length > 0 && r2.partial, '对调两格应报错');
console.log('   对调 2 格 ->', r2.errors[0]);
const short = R.stringToFacelets('WYGBRO');
ok(!!short.error, '长度不对应报错');
console.log('   长度不足 ->', short.error);

console.log(`\n结果: 通过 ${pass}, 失败 ${fail} ${fail === 0 ? '✅' : '❌'}`);
