/* verify_render.js — 校验页面渲染出的贴纸与引擎是否逐张一致
 * 用法:
 *   node verify_render.js <dom.html> "<scramble>"                  # 比对初始状态
 *   node verify_render.js <dom.html> --state <54字母>              # 比对指定状态
 *   node verify_render.js <dom.html> "<scramble>" --moves <K>      # 比对"执行 K 转之后"
 *   node verify_render.js <dom.html> "<scramble>" --cursor <N>     # 比对"第 N 步之后"(按当前拆步)
 */
const fs = require('fs');
const R = require('./engine.js');

const args = process.argv.slice(2);
const htmlPath = args[0];
let scramble = null, stateStr = null, movesArg = null, cursorArg = 0;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--state') stateStr = args[++i];
  else if (args[i] === '--moves') movesArg = parseInt(args[++i], 10);
  else if (args[i] === '--cursor') cursorArg = parseInt(args[++i], 10);
  else if (!scramble) scramble = args[i];
}
if (!scramble && !stateStr) scramble = 'R U';
if (scramble) scramble = scramble.split(/\s+/).filter(Boolean);
const cursor = cursorArg;
const html = fs.readFileSync(htmlPath, 'utf8');

const HEX2IDX = {
  '#f4f6f8': 0, '#ffd500': 1, '#00a651': 2, '#0051ba': 3, '#c41e3a': 4, '#ff8c00': 5,
  'rgb(244, 246, 248)': 0, 'rgb(255, 213, 0)': 1, 'rgb(0, 166, 81)': 2,
  'rgb(0, 81, 186)': 3, 'rgb(196, 30, 58)': 4, 'rgb(255, 140, 0)': 5,
};
const DIR = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };

// 解析每个 cubie: transform 里的 translate3d 定位 + 每个方向的贴纸颜色
const rendered = {};
const cubieRe = /<div class="cubie[^"]*" style="([^"]*)">([\s\S]*?)(?=<div class="cubie[ ">]|<div class="turn|$)/g;
let m, count = 0;
while ((m = cubieRe.exec(html))) {
  const style = m[1], body = m[2];
  const t = /translate3d\((-?\d+)px,\s*(-?\d+)px,\s*(-?\d+)px\)/.exec(style);
  if (!t) continue;
  const pos = [Math.round(+t[1] / 50), Math.round(-+t[2] / 50), Math.round(+t[3] / 50)];
  count++;
  const faceRe = /data-dir="([UDFBRL])"[^>]*>\s*<div class="stick" style="([^"]*)"/g;
  let fm;
  while ((fm = faceRe.exec(body))) {
    const dir = fm[1], st = fm[2];
    if (/visibility:\s*hidden/.test(st)) continue;
    const bg = /background(?:-color)?:\s*([^;"]+)/.exec(st);
    if (!bg) continue;
    const key = bg[1].trim();
    const idx = HEX2IDX[key];
    if (idx === undefined) { console.log('未知颜色:', key); continue; }
    rendered[pos.join(',') + '|' + DIR[dir].join(',')] = idx;
  }
}

let target;
if (stateStr) {
  const parsed = R.stateFromFacelets(R.stringToFacelets(stateStr).colors);
  if (!parsed.state || parsed.errors.length) { console.log('状态串不合法:', parsed.errors); process.exit(1); }
  target = parsed.state;
  console.log('(按导入状态串比对)');
} else {
  target = R.applyAlg(R.solved(), scramble);
  if (movesArg !== null) {
    const plan = R.buildPlan(scramble);
    const seq = [];
    plan.stages.forEach((st) => seq.push.apply(seq, st.moves || []));
    for (let i = 0; i < movesArg && i < seq.length; i++) target = R.applyAlg(target, [seq[i]]);
    console.log(`(按已执行 ${movesArg} 转比对: ${seq.slice(0, movesArg).join(' ')})`);
  } else if (cursor > 0) {
    const plan = R.buildPlan(scramble);
    const flat = [];
    plan.stages.forEach((st) => st.steps.forEach((x) => flat.push(x)));
    for (let i = 0; i < cursor && i < flat.length; i++) target = R.applyAlg(target, flat[i].moves);
    console.log(`(按计划前进 ${Math.min(cursor, flat.length)} 步后比对)`);
  }
}
const expect = R.stickerMap(target);
let ok = 0, bad = 0, missing = 0, extra = 0;
for (const k of Object.keys(expect)) {
  if (!(k in rendered)) { missing++; console.log('缺少贴纸:', k, '期望', expect[k]); continue; }
  if (rendered[k] === expect[k]) ok++;
  else { bad++; console.log('颜色不符:', k, '渲染', rendered[k], '期望', expect[k]); }
}
for (const k of Object.keys(rendered)) if (!(k in expect)) { extra++; console.log('多余贴纸:', k); }

console.log(`\ncubie 元素数 = ${count} (应为 26)`);
console.log(`贴纸比对: 一致 ${ok} / 不符 ${bad} / 缺失 ${missing} / 多余 ${extra}  (期望共 ${Object.keys(expect).length} 张)`);
console.log(count === 26 && ok === 54 && bad + missing + extra === 0 ? '✅ 渲染与引擎完全一致' : '❌ 存在差异');
