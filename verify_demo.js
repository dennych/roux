/* verify_demo.js — 校验"试转"功能: 转完后状态必须回到原位
 * 用法: node verify_demo.js <dumped-dom.html> "<scramble>"
 */
const fs = require('fs');
const R = require('./engine.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const scramble = (process.argv[3] || "R U F' L2 D B R'").split(/\s+/).filter(Boolean);
const mk = /data-demo="done\|([^|]*)\|(\d+)"/.exec(html);
if (!mk) { console.log('❌ 试转未跑完'); process.exit(1); }
const cursor = parseInt(mk[2], 10);
const plan = R.buildPlan(scramble);
const flat = [];
plan.stages.forEach((st) => st.steps.forEach((s) => flat.push(s)));
let want = R.applyAlg(R.solved(), scramble);
for (let i = 0; i < cursor; i++) want = R.applyAlg(want, flat[i].moves);
console.log(`试转后: cursor=${cursor} 状态回到原位=${mk[1] === R.encode(want) ? '✅' : '❌'}`);
