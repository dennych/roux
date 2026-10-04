/* verify_import.js — 校验"导入状态 → 跟着做 → 还原"整条链路
 * 用法: node verify_import.js <dumped-dom.html>
 */
const fs = require('fs');
const R = require('./engine.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const mk = /data-autoplay="done\|([^|]*)\|(\d+)"/.exec(html);
if (!mk) { console.log('❌ 自动播放未跑完（可能被中断或出错）'); process.exit(1); }
const solved = R.encode(R.solved());
const err = /data-error="([^"]*)"/.exec(html);
console.log(`导入状态 → 自动执行全部 ${mk[2]} 步 → 最终是否还原: ${mk[1] === solved ? '✅ 是' : '❌ 否'}`);
if (err) console.log('  页面报错:', err[1]);
