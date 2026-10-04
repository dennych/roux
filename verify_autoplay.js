const fs = require('fs');
const R = require('./engine.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const n = parseInt(process.argv[3], 10);
/* 用法: node verify_autoplay.js <dumped-dom.html> <N> "<scramble>" */
const scramble = (process.argv[4] || "R U F' L2 D B R'").split(/\s+/).filter(Boolean);
const mk = /data-autoplay="done\|([^|]*)\|(\d+)"/.exec(html);
if (!mk) { console.log('❌ 没有完成标记 (自动播放未跑完)'); process.exit(1); }
const got = mk[1], cursor = parseInt(mk[2], 10);
const plan = R.buildPlan(scramble);
const flat = [];
plan.stages.forEach((st) => st.steps.forEach((s) => flat.push(s)));
let s = R.applyAlg(R.solved(), scramble);
for (let i = 0; i < n; i++) s = R.applyAlg(s, flat[i].moves);
const want = R.encode(s);
console.log(`自动播放 ${n} 步: cursor=${cursor} 状态一致=${got === want ? '✅' : '❌'}`);
if (got !== want) console.log('  got =', got, '\n  want=', want);
