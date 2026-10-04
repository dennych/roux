/* verify_reimport.js — 校验"重新填色/导入时, 正在进行的动画必须被打断并复位"
 * 用法: node verify_reimport.js <dumped-dom.html>
 */
const fs = require('fs');
const R = require('./engine.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const m = /data-reimport="done\|(\w+)\|(\d+)\|(\w+)\|(\w+)"/.exec(html);
if (!m) { console.log('❌ 重新导入流程没跑完'); process.exit(1); }
console.log(`重新导入后: 动画状态=${m[1]} (应 idle)  cursor=${m[2]} (应 0)  画面=${m[3]} (应 newstate)  「下一步」=${m[4]} (应 enabled)`);
const ok = m[1] === 'idle' && m[2] === '0' && m[3] === 'newstate' && m[4] === 'enabled';
console.log(ok ? '✅ 已正确复位到新的填色方案' : '❌ 仍被旧动画固化');
