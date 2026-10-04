/* test_cssrotation.js — 校验"动画旋转方向"与"引擎的转动"完全一致
 *
 * 原理: 方块在屏幕上按 (x, -y, z) 摆放, 即 CSS 坐标 = S·模型坐标 (S = diag(1,-1,1))。
 *       要让动画看起来等于"转完之后重新上色", 必须有  CSS矩阵 = S · 模型矩阵 · S。
 *       模型矩阵用引擎的 rotateCoord 在层内点上交叉验证, 不靠手推。
 */
const R = require('./engine.js');

const S = [[1, 0, 0], [0, -1, 0], [0, 0, 1]];
const NORMAL = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0], M: [-1, 0, 0], r: [1, 0, 0] };
const MOVES = ['U', 'U2', "U'", 'D', 'D2', "D'", 'R', 'R2', "R'", 'L', 'L2', "L'",
  'F', 'F2', "F'", 'B', 'B2', "B'", 'M', 'M2', "M'", 'r', 'r2', "r'"];

const mul = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const apply = (A, v) => [0, 1, 2].map((i) => A[i][0] * v[0] + A[i][1] * v[1] + A[i][2] * v[2]);
function rodrigues(n, deg) {                       // 标准右手法则旋转矩阵
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), [x, y, z] = n;
  return [
    [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
    [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
    [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
  ];
}
function cssMat(mv) {                              // 解析引擎给出的 CSS 变换
  const str = R.cssRotation(mv);
  const m = /rotate([XYZ])\((-?[\d.]+)deg\)/.exec(str);
  if (!m) throw new Error('无法解析 ' + str);
  const deg = parseFloat(m[2]);
  if (m[1] === 'X') return rodrigues([1, 0, 0], deg), rodrigues([1, 0, 0], deg);
  return rodrigues(m[1] === 'X' ? [1, 0, 0] : m[1] === 'Y' ? [0, 1, 0] : [0, 0, 1], deg);
}
const maxdiff = (A, B) => Math.max(...A.flatMap((row, i) => row.map((v, j) => Math.abs(v - B[i][j]))));

let pass = 0, fail = 0;
console.log('转动   CSS 变换          与引擎一致   模型↔引擎交叉验证');
for (const mv of MOVES) {
  const times = mv.length > 1 ? (mv[1] === '2' ? 2 : -1) : 1;
  const model = rodrigues(NORMAL[mv[0]], -90 * times);          // 顺时针 = 绕外法线 -90°
  const want = mul(S, mul(model, S));
  const got = cssMat(mv);
  const d = maxdiff(got, want);
  // 交叉验证: 用引擎的 rotateCoord 检查"模型矩阵"本身对不对 (取层内点)
  let cross = true;
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const p = [x, y, z];
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) !== 3) continue;    // 只用角块坐标
    if (!R.inMoveLayer(mv, p)) continue;
    const got2 = R.rotateCoord(mv, p);
    const exp = apply(model, p);
    if (maxdiff([got2], [exp]) > 1e-9) cross = false;
  }
  const ok = d < 1e-9 && cross;
  if (ok) pass++; else fail++;
  console.log(`${mv.padEnd(4)} ${R.cssRotation(mv).padEnd(18)} ${d < 1e-9 ? '✅' : '❌ 差' + d.toFixed(2)}          ${cross ? '✅' : '❌'}`);
}
// ---------- 第二部分: 视觉等价 ----------
// 动画转到 90° 时看到的画面, 必须与"落地后按新状态重新上色"的画面逐格一致:
//   动画终点: 该层方块转到 M·p, 贴纸朝向 M·n, 颜色仍是转前的颜色
//   落地之后: 方块回到 p', 贴纸朝向 n, 颜色取自转后的状态
const DIRS = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };
function visualSets(state, mv) {
  const before = R.stickerMap(state);
  const after = R.stickerMap(R.applyAlg(state, [mv]));
  // 关键: 这里必须用"浏览器实际会执行的 CSS 旋转"换回模型坐标, 才是动画真正显示的画面
  const M = mul(S, mul(cssMat(mv), S));
  const inLayer = (p) => R.inMoveLayer(mv, p);
  const A = [], B = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) === 0) continue;
    const p = [x, y, z];
    const map = inLayer(p) ? M : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const f of Object.keys(DIRS)) {
      const n = DIRS[f];
      const c = before[p.join(',') + '|' + n.join(',')];
      if (c === undefined) continue;
      const q = apply(map, p).map(Math.round), m = apply(map, n).map(Math.round);
      A.push(q.join(',') + '|' + m.join(',') + '|' + c);
      if (inLayer(p)) B.push(p.join(',') + '|' + n.join(',') + '|' + c);   // 动画终点该方块最终落点由 M 决定, 下面用 after 覆盖
    }
  }
  // B 用"落地后"的真实状态来构造: 每个坐标每个朝向取 after 的颜色
  const B2 = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) === 0) continue;
    const p = [x, y, z];
    for (const f of Object.keys(DIRS)) {
      const n = DIRS[f];
      const c = after[p.join(',') + '|' + n.join(',')];
      if (c === undefined) continue;
      B2.push(p.join(',') + '|' + n.join(',') + '|' + c);
    }
  }
  A.sort(); B2.sort();
  return { A, B2 };
}
let vpass = 0, vfail = 0;
const states = [R.solved(), R.applyAlg(R.solved(), ['R', 'U', "F'", 'L2', 'D', 'B', "R'", 'M', 'U2'])];
for (const mv of MOVES) {
  let ok = true, detail = '';
  for (const st of states) {
    const { A, B2 } = visualSets(st, mv);
    if (A.length !== B2.length || A.some((v, i) => v !== B2[i])) {
      ok = false;
      const miss = A.filter((v) => B2.indexOf(v) < 0).slice(0, 2);
      detail = '差异例: ' + miss.join(' / ');
      break;
    }
  }
  if (ok) vpass++; else vfail++;
  console.log(`视觉等价 ${mv.padEnd(4)} ${ok ? '✅' : '❌ ' + detail}`);
}
console.log(`\n矩阵校验: 通过 ${pass}, 失败 ${fail}   视觉等价: 通过 ${vpass}, 失败 ${vfail} ${(fail || vfail) ? '❌' : '✅'}`);
process.exit((fail || vfail) ? 1 : 0);
