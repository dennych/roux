/* verify_pause.js — 校验"暂停/继续"：暂停期间画面必须冻结，继续后要能跑完
 * 用法: node verify_pause.js <dumped-dom.html> "<scramble>" <期望步数>
 */
const fs = require('fs');
const R = require('./engine.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const scramble = (process.argv[3] || "R U F' L2 D B R'").split(/\s+/).filter(Boolean);
const n = parseInt(process.argv[4] || '3', 10);
const chunk = parseInt(process.argv[5] || '0', 10);      // 0 = 整条公式
const mk = /data-pausecycle="done\|([^|]*)\|(\d+)\|(\w+)"/.exec(html);
if (!mk) { console.log('❌ 暂停/继续流程没跑完（可能死锁）'); process.exit(1); }
const frozen = mk[3] === 'frozen';
const plan = R.buildPlan(scramble);
R.rechunkPlan(plan, chunk || null);                      // 与页面拆步口径一致
const flat = [];
plan.stages.forEach((st) => st.steps.forEach((s) => flat.push(s)));
let want = R.applyAlg(R.solved(), scramble);
for (let i = 0; i < n; i++) want = R.applyAlg(want, flat[i].moves);
console.log(`暂停期间画面冻结: ${frozen ? '✅' : '❌ 仍在动'}`);
console.log(`继续后执行完 ${n} 步: cursor=${mk[2]} 状态一致=${mk[1] === R.encode(want) ? '✅' : '❌'}`);
