/* app.js — 桥式教学页面交互 (26 个小方块拼装的 3D 渲染) */
(function () {
  'use strict';
  window.addEventListener('error', (e) => {
    try { document.body.setAttribute('data-error', String(e.message) + ' @' + e.lineno + ':' + e.colno); } catch (x) { /* ignore */ }
  });
  const R = window.Roux;

  const COLORS = ['#f4f6f8', '#ffd500', '#00a651', '#0051ba', '#c41e3a', '#ff8c00'];
  const COLOR_NAME = ['白', '黄', '绿', '蓝', '红', '橙'];
  const FACES = ['U', 'D', 'F', 'B', 'R', 'L'];
  const DIR_VEC = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };
  const PITCH = 50, HALF = 24;

  /** 阶段提示 (随朝向变化, 颜色名跟着换) */
  function stageHint(key) {
    const o = R.getOrientation();
    const cn = (f) => COLOR_NAME[o.map[f]];
    if (key === 'fb') {
      return `搭出左侧 1×2×3（左桥 = ${cn('L')}面）：${cn('L')}中心 + DL/FL/BL 三条棱 + DFL/DBL 两个角。`
        + '蓝框高亮的块就是左桥目标位。';
    }
    if (key === 'sb') {
      return `搭出右侧 1×2×3（右桥 = ${cn('R')}面），同时不破坏左桥。`
        + '这一段只用到 U / R / M / r，所以左桥一定是安全的。';
    }
    if (key === 'cmll') {
      return `还原顶层（${cn('U')}面）4 个角块：先用 AUF + 小鱼/反小鱼把朝向做好，再用 T-perm/Y-perm 换位。`
        + '会打乱顶层棱块，交给 LSE。';
    }
    return '只转 M 和 U（4a 调棱色相 → 4b 归位 UL·UR → 4c 收 M 层）。这里是桥式的精髓，靠理解而非公式。';
  }

  const el = (id) => document.getElementById(id);
  const scene = el('scene'), cube = el('cube'), netview = el('netview');

  const HAS3D = !!(window.CSS && CSS.supports && CSS.supports('transform-style', 'preserve-3d')
    && CSS.supports('perspective', '1000px'));

  const S = {
    plan: null, flat: [], cursor: 0, state: null,
    rx: -26, ry: -36, animating: false, playing: false, curMoveOfStep: -1,
    anim: true, auto: true, mode3d: HAS3D, dragging: false,
    moveMs: 1500, maxPerStep: 3, runToken: 0, paused: false, pauseResolvers: [],
  };

  // ================= 3D: 26 个小方块 =================
  const cubies = [];

  function placeCubie(c) {
    const [x, y, z] = c.pos;
    // CSS 的 y 轴向下, 模型 y 轴向上 -> 取负
    c.el.style.transform = `translate3d(${x * PITCH}px, ${-y * PITCH}px, ${z * PITCH}px)`;
  }

  function buildCubies() {
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const box = document.createElement('div');
          box.className = 'cubie';
          for (const d of FACES) {
            const f = document.createElement('div');
            f.className = 'cubie-face';
            f.dataset.dir = d;
            const st = document.createElement('div');
            st.className = 'stick';
            f.appendChild(st);
            box.appendChild(f);
          }
          const c = { el: box, pos: [x, y, z], home: [x, y, z] };
          cubies.push(c);
          cube.appendChild(box);
          placeCubie(c);
        }
      }
    }
  }

  /** 所有方块回到自己的固定格位 (颜色由状态决定, 与元素身份无关) */
  function resetCubiePositions() {
    for (const c of cubies) {
      if (c.pos[0] !== c.home[0] || c.pos[1] !== c.home[1] || c.pos[2] !== c.home[2]) {
        c.pos = c.home.slice();
        placeCubie(c);
      }
      if (c.el.parentNode !== cube) cube.appendChild(c.el);
    }
  }

  /** 清理可能残留的旋转组: 把里面的方块归位放回 cube (保证渲染永远自愈) */
  function clearStrayTurnGroups() {
    const strays = cube.querySelectorAll('.turn');
    if (!strays.length) return;
    Array.prototype.forEach.call(strays, (g) => {
      Array.prototype.forEach.call(Array.prototype.slice.call(g.children), (child) => {
        const c = cubies.find((x) => x.el === child);
        if (c) { c.pos = c.home.slice(); placeCubie(c); cube.appendChild(c.el); }
      });
      g.remove();
    });
  }

  /** 按状态给 26 个小方块上色: 有贴纸的方向上色, 否则留黑色塑料 */
  function renderCubies(state) {
    const map = R.stickerMap(state);
    for (const c of cubies) {
      const key = c.pos.join(',');
      const faces = c.el.children;
      for (let i = 0; i < faces.length; i++) {
        const d = faces[i].dataset.dir;
        const col = map[key + '|' + DIR_VEC[d].join(',')];
        const st = faces[i].firstChild;
        if (col === undefined || col < 0) st.style.visibility = 'hidden';
        else { st.style.visibility = 'visible'; st.style.background = COLORS[col]; }
      }
    }
  }

  /** 高亮当前阶段的目标块（左桥 / 右桥） */
  const TARGETS = {
    fb: [[-1, -1, 1], [-1, -1, -1], [-1, -1, 0], [-1, 0, 1], [-1, 0, -1], [-1, 0, 0]],
    sb: [[1, -1, 1], [1, -1, -1], [1, -1, 0], [1, 0, 1], [1, 0, -1], [1, 0, 0]],
  };
  function renderTargets(stageKey) {
    const want = TARGETS[stageKey];
    const set = new Set((want || []).map((p) => p.join(',')));
    for (const c of cubies) c.el.classList.toggle('target', set.has(c.pos.join(',')));
  }

  /** 逐面光照: 按当前视角给 6 个方向算亮度 */
  const LIGHT = (function () {
    const v = [-0.30, -0.72, 0.62];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  }());
  function updateLighting() {
    const rx = S.rx * Math.PI / 180, ry = S.ry * Math.PI / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    // CSS transform = rotateX(rx) rotateY(ry)  ->  矩阵 Rx * Ry
    const apply = (d) => {
      const [dx, dy, dz] = d;
      const x1 = cy * dx + sy * dz;
      const z1 = -sy * dx + cy * dz;
      return [x1, cx * dy - sx * z1, sx * dy + cx * z1];
    };
    const AMB = 0.66, K = 1 - AMB;
    const out = {};
    for (const f of FACES) {
      const dv = DIR_VEC[f];
      const [x, y, z] = apply([dv[0], -dv[1], dv[2]]);   // 模型 -> CSS
      const dot = x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2];
      out[f] = (AMB + K * Math.max(0, dot)).toFixed(3);
    }
    cube.style.setProperty('--lu', out.U);
    cube.style.setProperty('--ld', out.D);
    cube.style.setProperty('--lf', out.F);
    cube.style.setProperty('--lb', out.B);
    cube.style.setProperty('--lr', out.R);
    cube.style.setProperty('--ll', out.L);
  }

  /** 当前视角下正对屏幕的三个面 (用于给用户标明"你现在看到的是哪几面") */
  function visibleFaceLabels() {
    const rx = S.rx * Math.PI / 180, ry = S.ry * Math.PI / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const cn = R.getOrientation();
    const zhong = { U: '上', D: '下', F: '前', B: '后', R: '右', L: '左' };
    const out = [];
    for (const f of FACES) {
      const dv = DIR_VEC[f];
      const dx = dv[0], dy = -dv[1], dz = dv[2];             // 模型 -> CSS
      const x1 = cy * dx + sy * dz, z1 = -sy * dx + cy * dz;
      const y1 = dy;
      const vz = sx * y1 + cx * z1;                          // 朝屏幕外的分量
      if (vz > 0.35) out.push(`${zhong[f]}(${f}·${COLOR_NAME[cn.map[f]]})`);
    }
    return out;
  }

  function renderCube() {
    cube.style.transform = `rotateX(${S.rx}deg) rotateY(${S.ry}deg)`;
    updateLighting();
    if (el('visibleFaces')) {
      el('visibleFaces').textContent = '你现在看到的面：' + visibleFaceLabels().join(' · ');
    }
  }

  // ---------- 真实转层动画 ----------
  // 动画的旋转矩阵由引擎提供 (唯一真源, 有 test_cssrotation.js 把关)
  function cssRotation(mv) {
    if (!R.CSS_AXIS[mv[0]]) console.warn('未知转动的旋转轴:', mv);
    return R.cssRotation(mv);
  }

  /** 等两帧 (让 CSS 过渡能拿到初始值); 若环境不派发渲染帧则用超时兜底 */
  const raf2 = () => new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(() => requestAnimationFrame(fin)); } catch (e) { /* ignore */ }
    setTimeout(fin, 80);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function animateMove(mv, duration, nextState, token) {
    if (!S.anim || !S.mode3d || !HAS3D) return;
    const moving = cubies.filter((c) => R.inMoveLayer(mv, c.home));
    if (!moving.length) return;
    const group = document.createElement('div');
    group.className = 'turn';
    cube.appendChild(group);
    for (const c of moving) group.appendChild(c.el);
    group.style.transform = 'rotate3d(0,0,1,0deg)';
    try {
      await raf2();
      const dur = S.fast ? 0 : duration;
      group.style.transition = `transform ${dur}ms cubic-bezier(.35,.9,.4,1)`;
      group.style.transform = cssRotation(mv);
      await sleep(dur + 12);
    } finally {
      // 无论成功/异常/被打断: 都要"归位 + 清掉旋转组"
      try { resetCubiePositions(); } catch (e) { console.error(e); }
      // 只有本次动画仍然有效时才按新状态上色; 否则交给调用方 paintAll (避免旧动画把旧颜色写回屏幕)
      if (token === undefined || S.runToken === token) {
        try { renderCubies(nextState); } catch (e) { console.error(e); }
      }
      try { group.remove(); } catch (e) { /* ignore */ }
    }
  }

  // ================= 平面展开图 =================
  const netCells = {};
  function buildNet() {
    const layout = { U: [1, 2], L: [2, 1], F: [2, 2], R: [2, 3], B: [2, 4], D: [3, 2] };
    netview.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'net';
    for (const f of FACES) {
      const [r, c] = layout[f];
      const wrap = document.createElement('div');
      wrap.className = 'nwrap';
      wrap.style.left = ((c - 1) * 128) + 'px';
      wrap.style.top = ((r - 1) * 140) + 'px';
      const face = document.createElement('div');
      face.className = 'nface';
      netCells[f] = [];
      for (let i = 0; i < 9; i++) {
        const st = document.createElement('div');
        st.className = 'nst';
        face.appendChild(st);
        netCells[f].push(st);
      }
      const label = document.createElement('div');
      label.className = 'nlabel';
      label.textContent = f;
      wrap.appendChild(face);
      wrap.appendChild(label);
      grid.appendChild(wrap);
    }
    netview.appendChild(grid);
  }

  function renderNet(state) {
    for (const f of FACES) {
      const cols = R.faceColors(state, f);
      for (let i = 0; i < 9; i++) netCells[f][i].style.background = COLORS[cols[i]] || '#111';
    }
  }

  // ================= 手动填色 =================
  const PAINT = { cells: new Array(54).fill(-1), brush: 0 };
  const PAINT_FACES = ['U', 'L', 'F', 'R', 'B', 'D'];      // 与状态串顺序一致
  const PAINT_LAYOUT = { U: [1, 2], L: [2, 1], F: [2, 2], R: [2, 3], B: [2, 4], D: [3, 2] };
  let paintCells = {};

  function buildPalette() {
    const box = el('palette');
    box.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'pal' + (i === PAINT.brush ? ' on' : '');
      d.innerHTML = `<i style="background:${COLORS[i]}"></i>${COLOR_NAME[i]}`;
      d.onclick = () => { PAINT.brush = i; buildPalette(); };
      box.appendChild(d);
    }
    const er = document.createElement('div');
    er.className = 'pal' + (PAINT.brush === -1 ? ' on' : '');
    er.innerHTML = '<i style="background:#22262e"></i>橡皮';
    er.onclick = () => { PAINT.brush = -1; buildPalette(); };
    box.appendChild(er);
  }

  function buildPainter() {
    const box = el('painterNet');
    box.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'pnet';
    PAINT_FACES.forEach((f, fi) => {
      const [r, c] = PAINT_LAYOUT[f];
      const wrap = document.createElement('div');
      wrap.className = 'pwrap';
      wrap.style.left = ((c - 1) * 130) + 'px';
      wrap.style.top = ((r - 1) * 146) + 'px';
      const face = document.createElement('div');
      face.className = 'pface';
      for (let i = 0; i < 9; i++) {
        const idx = fi * 9 + i;
        const cell = document.createElement('div');
        cell.className = 'pcell';
        cell.dataset.idx = idx;
        cell.onclick = () => {
          PAINT.cells[idx] = PAINT.brush;
          renderPainter();
        };
        face.appendChild(cell);
        paintCells[idx] = cell;
      }
      const label = document.createElement('div');
      label.className = 'plabel';
      label.textContent = f;
      wrap.appendChild(face);
      wrap.appendChild(label);
      grid.appendChild(wrap);
    });
    box.appendChild(grid);
    renderPainter();
  }

  function renderPainter() {
    PAINT.cells.forEach((v, i) => {
      const c = paintCells[i];
      if (!c) return;
      c.style.background = v < 0 ? '#22262e' : COLORS[v];
    });
    const filled = PAINT.cells.filter((v) => v >= 0).length;
    if (el('paintMsg') && !el('paintMsg').dataset.keep) {
      el('paintMsg').innerHTML = filled === 54
        ? '<span style="color:var(--ok)">已填满 54 格，可以校验了</span>'
        : `已填 ${filled} / 54 格`;
    }
  }

  /** 重设: 清空填色 + 清空方案与界面, 回到"未开始" */
  function resetAll() {
    S.runToken++;
    S.playing = false; S.animating = false; S.paused = false;
    releasePause();
    PAINT.cells.fill(-1);
    renderPainter();
    el('stateInput').value = '';
    el('importMsg').textContent = '';
    el('paintMsg').dataset.keep = '1';
    el('paintMsg').innerHTML = '已重设：请重新填色，然后点「校验并开始还原」';
    S.plan = null; S.flat = []; S.cursor = 0; S.curMoveOfStep = -1;
    S.state = R.solved();
    if (el('planLabel')) el('planLabel').textContent = '当前：未载入（请在下面「手动填色」填 54 格，或粘贴状态串后点「解析并载入」）';
    if (el('nowMove')) el('nowMove').textContent = '';
    paintAll();
    if (S.mode3d) renderCube();
    renderTabs(); renderNext(); renderStatus(); renderPlan();
    if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
    toast('已重设，可以重新填色了');
  }

  function paintSetSolved() {
    const solved = R.faceletsFromState(R.solved());
    for (let i = 0; i < 54; i++) PAINT.cells[i] = solved[i];
    delete el('paintMsg').dataset.keep;
    renderPainter();
  }

  function paintValidate() {
    const missing = PAINT.cells.filter((v) => v < 0).length;
    if (missing) {
      el('paintMsg').dataset.keep = '1';
      el('paintMsg').innerHTML = `<span style="color:#ff8080">✗ 还有 ${missing} 格没填，无法载入</span>`;
      toast('还有 ' + missing + ' 格没填');
      return;
    }
    el('stateInput').value = R.faceletsToString(PAINT.cells);
    const ok = importState(PAINT.cells, '已手动填色导入', { scroll: true, flash: true });
    el('paintMsg').dataset.keep = '1';
    if (ok) {
      el('paintMsg').innerHTML = '<span style="color:var(--ok)">✓ 校验通过，已按这份填色重新计算（光标已回到第 0 步）</span>';
    } else {
      el('paintMsg').innerHTML = '<span style="color:#ff8080">✗ 校验没通过，见下面红字；修正后请再点一次</span>';
      el('importMsg').scrollIntoView && el('importMsg').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('校验没通过：请看红字说明');
    }
  }

  // ================= 公式表 =================
  const FORMULA_GROUPS = [
    {
      title: 'CMLL —— 顶层角块（先朝向，后位置）',
      items: [
        { name: 'AUF', alg: "U / U2 / U'", demo: 'U', use: "顶层对位：按需要用 U、U2 或 U' 把角块转到公式对应的位置" },
        { name: '小鱼（Sune）', alg: "R U R' U R U2 R'", use: '顶层角块朝向（顺带换位置，位置交给下一步）' },
        { name: '反小鱼（Antisune）', alg: "R U2 R' U' R U' R'", use: '顶层角块朝向（与小鱼类互为反向）' },
        { name: 'T-perm', alg: "R U R' U' R' F R2 U' R' U' R U R' F'", use: '相邻两角互换（URF↔UBR；另换两棱，LSE 会收掉）' },
      ],
    },
    {
      title: 'CMLL 备用公式（可选，能让 CMLL 更短）',
      items: [
        { name: 'Y-perm', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'", use: '对角两角互换（URF↔ULB），引擎搜索里也用到' },
      ],
    },
    {
      title: 'LSE 参考公式（本工具不依赖，认识一下）',
      items: [
        { name: 'U-perm', alg: "M2 U M U2 M' U M2", use: '顶层三棱循环 UR→UF→UL，角块不动' },
        { name: 'H-perm', alg: 'M2 U2 M2 U2', use: 'UF↔UB、DF↔DB 两对棱互换，角块不动' },
        { name: '翻两棱', alg: "M' U M' U M' U2 M U M U M U2", use: '把 UF、UB 两条棱原地翻正（2 条坏棱时）' },
      ],
    },
  ];

  function renderFormulas() {
    const box = el('formulaList');
    if (!box) return;
    box.innerHTML = '';
    for (const g of FORMULA_GROUPS) {
      const wrap = document.createElement('div');
      wrap.className = 'fgroup';
      const t = document.createElement('div');
      t.className = 'ft';
      t.textContent = g.title;
      wrap.appendChild(t);
      for (const it of g.items) {
        const row = document.createElement('div');
        row.className = 'frow';
        const nm = document.createElement('span');
        nm.className = 'fname';
        nm.textContent = it.name;
        const alg = document.createElement('span');
        alg.className = 'falg';
        alg.textContent = it.alg;
        const use = document.createElement('span');
        use.className = 'fuse';
        use.textContent = it.use;
        const bDemo = document.createElement('button');
        bDemo.textContent = '试转';
        bDemo.onclick = () => demoFormula(it.demo || it.alg);
        const bCopy = document.createElement('button');
        bCopy.className = 'ghost';
        bCopy.textContent = '复制';
        bCopy.onclick = async () => {
          try { await navigator.clipboard.writeText(it.alg); toast('已复制：' + it.name); }
          catch (e) { toast('复制失败，请手动选择'); }
        };
        row.appendChild(nm); row.appendChild(alg); row.appendChild(use);
        row.appendChild(bDemo); row.appendChild(bCopy);
        wrap.appendChild(row);
      }
      box.appendChild(wrap);
    }
  }

  const invertMove = (mv) => (mv.endsWith("'") ? mv.slice(0, -1) : (mv.endsWith('2') ? mv : mv + "'"));
  const is180 = (mv) => /2$/.test(mv);
  const tapeHtml = (moves, curIdx) => moves.map((m, k) =>
    `<span class="${k === curIdx ? 'cur ' : ''}${is180(m) ? 'm180' : ''}">${m}</span>`).join(' ');

  /** 试转: 正着转一遍, 停一下, 再倒着转回原样 (不影响当前进度) */
  async function demoFormula(algText) {
    if (S.animating) return;
    const moves = algText.split(/\s+/).filter((m) => /^[UDFBRLMr](2|')?$/.test(m));
    if (!moves.length) return;
    const token = ++S.runToken;
    S.animating = true;
    renderNext();
    let cur = R.cloneState(S.state);
    const demoMs = Math.max(200, Math.round(S.moveMs * 0.6));
    const play = async (list, sign) => {
      for (let i = 0; i < list.length; i++) {
        await pauseGate();
        if (S.runToken !== token) return false;
        const mv = sign > 0 ? list[i] : invertMove(list[i]);
        const next = R.applyAlg(cur, [mv]);
        showNowMove('演示 ' + mv, i, list.length);
        if (S.anim && S.mode3d && HAS3D) { await animateMove(mv, demoMs, next, token); await sleep(50); }
        else { await sleep(110); }
        cur = next;
        S.state = next;
        renderCubies(next); renderNet(next); renderStatus();
      }
      return true;
    };
    let ok = await play(moves, 1);
    if (ok) { showNowMove('（看效果…）', 0, 0); await sleep(500); }
    if (ok) ok = await play(moves.slice().reverse(), -1);
    S.animating = false;
    showNowMove('', 0, 0);
    S.state = stateAt(S.cursor);
    renderAll();
  }

  // ================= 视角 / 模式 =================
  const VIEWS = [
    ['标准 上/前/右', -26, -36], ['看左桥 上/前/左', -26, 36], ['看右桥 上/后/右', -26, -144],
    ['前', 0, 0], ['后', 0, 180], ['左', 0, 90], ['右', 0, -90], ['上', -88, 0], ['下', 88, 0],
  ];
  function buildViews() {
    const box = el('views');
    box.innerHTML = '';
    for (const [name, rx, ry] of VIEWS) {
      const b = document.createElement('button');
      b.textContent = name;
      if (name.indexOf('标准') === 0) b.className = 'ghost';
      b.onclick = () => {
        S.rx = rx; S.ry = ry;
        S.auto = false; el('chkAuto').checked = false;
        renderCube();
      };
      box.appendChild(b);
    }
    renderLegend();
  }

  /** 图例: 颜色 -> 它当前是哪个面 */
  function renderLegend() {
    const o = R.getOrientation();
    const face = {};
    for (const f of FACES) face[o.map[f]] = f;
    el('legend').innerHTML = COLORS.map((c, i) =>
      `<span><i style="background:${c}"></i>${COLOR_NAME[i]}(${face[i] || '?'})</span>`).join('');
  }

  /** 朝向下拉框 */
  function buildOrientSelect() {
    const sel = el('selOrient');
    sel.innerHTML = '';
    for (const [k, v] of Object.entries(R.ORIENTATIONS)) {
      const op = document.createElement('option');
      op.value = k;
      op.textContent = v.name;
      sel.appendChild(op);
    }
    sel.value = R.getOrientation().key;
    sel.onchange = () => {
      if (!R.setOrientation(sel.value)) return;
      renderLegend();
      paintAll();
      renderTabs();
      renderNext();
      setMode(S.mode3d);
    };
  }

  function setMode(threeD) {
    S.mode3d = !!threeD && HAS3D;
    scene.classList.toggle('net', !S.mode3d);
    el('btn3d').classList.toggle('on', S.mode3d);
    el('btnNet').classList.toggle('on', !S.mode3d);
    if (S.mode3d) renderCube();
    el('renderNote').textContent = (HAS3D
      ? '立体视图由 26 个小方块拼装（有缝隙、遮挡和逐面光照）；拖动可旋转，取消勾选"自动旋转"可固定视角。'
      : '当前浏览器不支持 CSS 3D（preserve-3d），已自动切到平面展开图。')
      + ' 当前朝向：' + R.getOrientation().name + '——请把实体魔方也摆成这个朝向再跟着转。';
  }

  (function drag() {
    let x0 = 0, y0 = 0, rx0 = 0, ry0 = 0;
    scene.addEventListener('pointerdown', (e) => {
      if (!S.mode3d) return;
      S.dragging = true; x0 = e.clientX; y0 = e.clientY; rx0 = S.rx; ry0 = S.ry;
      try { scene.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    scene.addEventListener('pointermove', (e) => {
      if (!S.dragging) return;
      S.ry = ry0 + (e.clientX - x0) * 0.55;
      S.rx = Math.max(-89, Math.min(89, rx0 - (e.clientY - y0) * 0.55));
      renderCube();
    });
    const up = () => { S.dragging = false; };
    scene.addEventListener('pointerup', up);
    scene.addEventListener('pointercancel', up);
  }());

  function tick() {
    if (S.auto && !S.dragging && S.mode3d && !S.animating) {
      S.ry += 0.18;
      renderCube();
    }
    requestAnimationFrame(tick);
  }

  // ================= 计划与状态 =================
  function stateAt(cursor) {
    let s = R.cloneState(S.plan.scrambleState);
    for (let i = 0; i < cursor && i < S.flat.length; i++) s = R.applyAlg(s, S.flat[i].step.moves);
    return s;
  }

  function stageOfCursor() {
    if (!S.flat.length) return 0;
    return S.flat[Math.min(S.cursor, S.flat.length - 1)].si;
  }
  function currentStageKey() { return S.plan ? S.plan.stages[stageOfCursor()].key : 'fb'; }
  function allDone() { return S.cursor >= S.flat.length; }
  function stageDone(si) {
    const first = S.flat.findIndex((x) => x.si === si);
    return S.cursor >= first + S.plan.stages[si].steps.length;
  }
  function stageStarted(si) { return S.cursor > S.flat.findIndex((x) => x.si === si); }

  function paintAll() {
    clearStrayTurnGroups();          // 自愈: 清掉任何残留的旋转组
    renderCubies(S.state);
    renderNet(S.state);
    renderTargets(currentStageKey());
  }

  function renderAll() {
    S.state = stateAt(S.cursor);
    paintAll();
    if (S.mode3d) renderCube();
    renderTabs();
    renderNext();
    renderStatus();
    renderPlan();
  }

  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1600);
  }

  function renderTabs() {
    const box = el('tabs');
    box.innerHTML = '';
    if (!S.plan) {
      el('stageHint').textContent = '还没载入魔方：请在下面「手动填色」点好 54 格（或粘贴状态串），再点「校验并开始还原」。';
      return;
    }
    S.plan.stages.forEach((st, si) => {
      const done = stageDone(si);
      const active = stageOfCursor() === si && !allDone();
      const d = document.createElement('div');
      d.className = 'tab' + (done ? ' done' : '') + (active ? ' active' : '');
      const n = st.steps.reduce((m, s) => m + s.moves.length, 0);
      d.innerHTML = `${st.title}<span class="st">${done ? '✓ 完成' : (stageStarted(si) ? '进行中' : n + ' 步')}</span>`;
      d.onclick = () => {
        if (S.animating) return;
        S.cursor = S.flat.findIndex((x) => x.si === si);
        S.curMoveOfStep = -1;
        renderAll();
      };
      box.appendChild(d);
    });
    el('stageHint').textContent = stageHint(currentStageKey());
  }

  function renderNext() {
    const nm = el('nextName'), stg = el('nextStage'), mv = el('nextMoves'), hint = el('nextHint');
    const btnNext = el('btnNext'), btnPrev = el('btnPrev'), btnPlay = el('btnPlayStage');
    if (!S.plan) {
      nm.textContent = '未开始';
      stg.textContent = '';
      mv.textContent = '';
      hint.textContent = '先在下面「手动填色」填满 54 格，点「校验并开始还原」。';
      btnNext.disabled = true; btnPrev.disabled = true; btnPlay.disabled = true;
      const bp = el('btnPause'); bp.disabled = true; bp.textContent = '暂停 ⏸';
      el('progress').textContent = '';
      return;
    }
    if (allDone()) {
      nm.textContent = '🎉 已还原完成';
      stg.textContent = '';
      mv.textContent = '';
      hint.textContent = `总步数 ${S.plan.totalMoves}（含公式转动），每一步都由引擎校验过。`;
    } else {
      const cur = S.flat[S.cursor];
      nm.textContent = cur.step.name;
      stg.textContent = '· ' + cur.stage.title;
      mv.innerHTML = tapeHtml(cur.step.moves, S.curMoveOfStep);
      hint.textContent = cur.step.desc || '';
    }
    const btnPause = el('btnPause');
    btnNext.disabled = S.animating || allDone();
    btnPrev.disabled = allDone() || (S.animating && !S.paused) || (!S.animating && S.cursor === 0);
    btnPrev.textContent = (S.animating && S.paused) ? '放弃本步' : '← 上一步';
    btnPause.disabled = !S.animating;
    btnPause.textContent = S.paused ? '继续 ▶' : '暂停 ⏸';
    btnPause.classList.toggle('on', S.paused);
    btnPlay.disabled = allDone() || (S.animating && !S.playing);
    btnPlay.textContent = S.playing ? '停止播放' : '自动播放本阶段';
    el('progress').textContent = `进度：${S.cursor} / ${S.flat.length} 步　·　总转数 ${S.plan.totalMoves}`
      + (S.maxPerStep ? `　·　每步 ≤${S.maxPerStep} 转` : '　·　整条公式');
    [...el('tabs').children].forEach((c, si) => c.classList.toggle('active', stageOfCursor() === si && !allDone()));
    el('stageHint').textContent = stageHint(currentStageKey());
  }

  /** 画面自检: 逐格比对 DOM 上的颜色与引擎计算的颜色 */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  function renderSelfCheck() {
    const RGB2IDX = {};
    COLORS.forEach((c, i) => { RGB2IDX[hexToRgb(c)] = i; RGB2IDX[c] = i; });
    const map = R.stickerMap(S.state);
    const bad = [];
    let total = 0;
    for (const c of cubies) {
      const key = c.pos.join(',');
      Array.prototype.forEach.call(c.el.children, (faceEl) => {
        const d = faceEl.dataset.dir;
        const want = map[key + '|' + DIR_VEC[d].join(',')];
        const st = faceEl.firstChild;
        const hidden = st.style.visibility === 'hidden';
        const shown = hidden ? -1 : (RGB2IDX[st.style.background] !== undefined ? RGB2IDX[st.style.background] : -2);
        total++;
        if ((want === undefined ? -1 : want) !== shown) bad.push(`${key}|${d}: 画面${shown} 期望${want}`);
      });
    }
    const stray = document.querySelectorAll('.turn').length;
    const msg = (bad.length === 0 ? `✓ 画面与引擎一致（${total} 格）` : `✗ 有 ${bad.length} 格不一致：${bad.slice(0, 6).join(' ; ')}`)
      + (stray ? `（另有 ${stray} 个残留旋转组）` : '');
    el('checkMsg').innerHTML = bad.length || stray
      ? `<span style="color:#ff8080">${msg}</span>`
      : `<span style="color:var(--ok)">${msg}</span>`;
    document.body.setAttribute('data-rendercheck', (bad.length || stray) ? msg : 'ok');
    toast(bad.length || stray ? '自检：画面与引擎不一致' : '自检：一致 ✓');
  }

  function badEdges(s) {
    let n = 0;
    for (const i of [0, 1, 2, 3, 5, 7]) if (s.eo[i]) n++;
    return n;
  }

  function renderStatus() {
    const s = S.state;
    const items = [
      ['左桥 1×2×3', R.fbSolved(s)],
      ['右桥 1×2×3', R.sbSolved(s)],
      ['两桥完好', R.blocksSolved(s)],
      ['顶层角块 CMLL', R.cornersSolved(s)],
      ['棱色相 EO', R.eoSolved(s)],
      ['整体还原', R.isSolved(s)],
    ];
    el('status').innerHTML = items.map(([k, v]) =>
      `<div class="st-item"><b>${k}</b><span class="${v ? 'yes' : 'no'}">${v ? '✓ 已完成' : '· 未完成'}</span></div>`).join('')
      + `<div class="st-item"><b>坏棱数量（LSE 用）</b><span class="${badEdges(s) === 0 ? 'yes' : 'no'}">${badEdges(s)} / 6</span></div>`;
  }

  function renderPlan() {
    const box = el('plan');
    box.innerHTML = '';
    if (!S.plan) return;
    S.plan.stages.forEach((st, si) => {
      const g = document.createElement('div');
      g.className = 'grp';
      const n = st.steps.reduce((m, s) => m + s.moves.length, 0);
      const head = document.createElement('div');
      head.className = 'gt';
      head.innerHTML = `<b>${st.title}</b><span class="badge">${n} 步</span>`;
      g.appendChild(head);
      st.steps.forEach((step, ji) => {
        const flatIdx = S.flat.findIndex((x) => x.si === si && x.ji === ji);
        const d = document.createElement('div');
        d.className = 'item' + (flatIdx < S.cursor ? ' done' : '') + (flatIdx === S.cursor ? ' cur' : '');
        d.innerHTML = `<span>${flatIdx < S.cursor ? '✓' : (flatIdx === S.cursor ? '▶' : '·')} ${step.name}</span>`
          + `<span class="mv">${step.moves.join(' ')}</span>`;
        d.onclick = () => {
          if (S.animating) return;
          S.cursor = flatIdx + 1;
          S.curMoveOfStep = -1;
          renderAll();
        };
        g.appendChild(d);
      });
      box.appendChild(g);
    });
  }

  // ================= 播放 =================
  /** 暂停闸门: 暂停时在这里等待, 恢复时放行 */
  function pauseGate() {
    if (!S.paused) return Promise.resolve();
    return new Promise((resolve) => { S.pauseResolvers.push(resolve); });
  }
  function releasePause() {
    const rs = S.pauseResolvers;
    S.pauseResolvers = [];
    rs.forEach((r) => r());
  }
  function setPaused(v) {
    S.paused = !!v;
    if (!S.paused) {
      releasePause();
    } else {
      const cur = S.flat[S.cursor];
      const i = S.curMoveOfStep;
      if (cur && i >= 0 && cur.step.moves[i]) {
        el('nowMove').innerHTML = `⏸ 已暂停：停在第 ${i + 1}/${cur.step.moves.length} 转（${cur.step.moves[i]}）`
          + '<span style="color:var(--dim)"> — 点「继续 ▶」接着走</span>';
      }
    }
    renderNext();
  }
  function togglePause() {
    if (!S.animating) return;
    setPaused(!S.paused);
  }
  /** 放弃当前这一步: 回滚到本步开始 */
  function abortStep() {
    S.runToken++;
    S.paused = false;
    releasePause();
    S.animating = false;
    S.playing = false;
    showNowMove('', 0, 0);
    S.state = stateAt(S.cursor);
    renderAll();
  }

  /** 每一步转动的总时长 (毫秒): 旋转占 70%, 结束后停留 30%, 便于看清 */
  const rotateMs = () => Math.max(120, Math.round(S.moveMs * 0.7));
  const holdMs = () => Math.max(80, Math.round(S.moveMs * 0.3));

  function showNowMove(mv, i, total) {
    el('nowMove').innerHTML = mv
      ? `正在转：<span class="big">${mv}</span>`
        + (is180(mv) ? '<span style="color:#ffd166"> 180°</span>' : '')
        + ` <span style="color:var(--dim)">(${i + 1}/${total})</span>`
      : '';
  }

  async function doStep(step, token) {
    for (let i = 0; i < step.moves.length; i++) {
      await pauseGate();                               // 暂停时在这里等
      if (S.runToken !== token) return false;          // 被中断 (停止播放 / 换局面 / 放弃本步)
      const mv = step.moves[i];
      S.curMoveOfStep = i;
      const cur = S.flat[S.cursor];
      if (cur) el('nextMoves').innerHTML = tapeHtml(cur.step.moves, i);
      showNowMove(mv, i, step.moves.length);
      const next = R.applyAlg(S.state, [mv]);
      if (S.anim && S.mode3d && HAS3D) {
        await animateMove(mv, rotateMs(), next, token);
        await sleep(is180(mv) ? Math.round(holdMs() * 1.6) : holdMs());
      } else {
        await sleep(S.moveMs);                          // 关掉转层动画时: 直接跳变 + 停留
      }
      if (S.runToken !== token) { paintAll(); return false; }
      S.state = next;
      renderCubies(S.state);
      renderNet(S.state);
      renderStatus();
    }
    S.curMoveOfStep = -1;
    showNowMove('', 0, 0);
    return true;
  }

  async function nextStep() {
    if (S.animating || allDone()) return;
    const token = ++S.runToken;
    S.animating = true;
    renderNext();
    let ok = false;
    try {
      ok = await doStep(S.flat[S.cursor].step, token);
    } catch (err) {
      console.error('步骤执行出错:', err);
    } finally {
      S.animating = false;
    }
    showNowMove('', 0, 0);
    if (S.paused) setPaused(false);
    if (ok && S.runToken === token) S.cursor++;
    renderAll();
  }

  async function playStage() {
    if (S.playing) { S.runToken++; S.playing = false; renderNext(); return; }   // 再次点击 = 停止
    if (S.animating || allDone()) return;
    const token = ++S.runToken;
    S.playing = true;
    const si = stageOfCursor();
    renderNext();
    while (S.playing && S.runToken === token && S.cursor < S.flat.length
           && S.flat[S.cursor].si === si) {
      S.animating = true;
      let ok = false;
      try {
        ok = await doStep(S.flat[S.cursor].step, token);
      } catch (err) {
        console.error('步骤执行出错:', err);
      } finally {
        S.animating = false;
      }
      if (!ok) break;
      S.cursor++;
      renderAll();
      await sleep(120);
    }
    S.playing = false;
    S.animating = false;
    showNowMove('', 0, 0);
    renderAll();
  }

  function prevStep() {
    if (S.animating) { if (S.paused) abortStep(); return; }   // 暂停中 → 放弃本步
    if (S.cursor === 0) return;
    S.playing = false;
    S.cursor--;
    S.curMoveOfStep = -1;
    renderAll();
  }

  // ================= 方案与计划 =================
  function parseScramble(text) {
    const toks = text.trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (let t of toks) {
      t = t.replace(/[’`]/g, "'").replace(/^([udlrfb])/, (m) => m.toUpperCase());
      if (!/^[UDLRFBM](2|')?$/.test(t)) return { error: '无法识别的转动：' + t };
      out.push(t);
    }
    if (!out.length) return { error: '打乱为空' };
    return { moves: out };
  }

  function rebuildFlat() {
    S.flat = [];
    if (!S.plan) return;
    S.plan.stages.forEach((st, si) => st.steps.forEach((step, ji) => S.flat.push({ si, ji, step, stage: st })));
  }

  function movesDone() {
    let n = 0;
    for (let i = 0; i < S.cursor && i < S.flat.length; i++) n += S.flat[i].step.moves.length;
    return n;
  }

  /** 按"每步最多转数"重新拆步, 并尽量保持进度 */
  function applyChunkSetting() {
    if (!S.plan) { renderNext(); return; }
    const done = movesDone();
    R.rechunkPlan(S.plan, S.maxPerStep || null);
    rebuildFlat();
    let acc = 0, cur = 0;
    for (const it of S.flat) {
      if (acc + it.step.moves.length > done) break;
      acc += it.step.moves.length;
      cur++;
    }
    S.cursor = cur;
    S.curMoveOfStep = -1;
    renderAll();
  }

  /** 统一装载方案 (打乱或导入状态) —— 会先中止正在进行的动画/播放/暂停 */
  function loadPlan(plan, label, opts) {
    S.runToken++;                       // 让旧动画/播放循环立刻退出 (否则它会把旧状态画回来)
    S.playing = false;
    S.animating = false;
    S.paused = false;
    releasePause();
    if (el('nowMove')) el('nowMove').textContent = '';
    S.plan = plan;
    R.rechunkPlan(S.plan, S.maxPerStep || null);
    rebuildFlat();
    S.cursor = 0;
    S.curMoveOfStep = -1;
    if (el('planLabel')) el('planLabel').textContent = '当前：' + label;
    const h = location.hash || '';
    const m = /cursor=(\d+)/.exec(h);
    if (m) S.cursor = Math.max(0, Math.min(S.flat.length, parseInt(m[1], 10)));
    renderAll();
        const dm = /demoidx=(\d+)/.exec(h);
        if (dm) {
          const all = FORMULA_GROUPS.reduce((acc, g) => acc.concat(g.items), []);
          const it = all[parseInt(dm[1], 10)];
          if (it) {
            void (async () => {
              await demoFormula(it.demo || it.alg);
              document.body.setAttribute('data-demo', 'done|' + R.encode(S.state) + '|' + S.cursor);
            })();
          }
        }
        if (/cssconvention=1/.test(h) && !S.testRan_cssconv) {
          S.testRan_cssconv = true;
          const box = document.createElement('div');
          box.style.position = 'absolute'; box.style.left = '-9999px';
          cube.appendChild(box);
          const out = {};
          for (const ax of ['X', 'Y', 'Z']) {
            box.style.transform = `rotate${ax}(90deg)`;
            out[ax] = getComputedStyle(box).transform;
          }
          box.remove();
          document.body.setAttribute('data-cssconvention', JSON.stringify(out));
        }
        if (/demomove=([URFDLBMr]'?2?)/.test(h) && !S.testRan_demomove) {
          S.testRan_demomove = true;
          const mv = /demomove=([URFDLBMr]'?2?)/.exec(h)[1];
          void (async () => { await demoFormula(mv); document.body.setAttribute('data-demomove', 'done'); })();
        }
        if (/selfcheck=(\d+)/.test(h) && !S.testRan_selfcheck) {
          S.testRan_selfcheck = true;
          const n = parseInt((/selfcheck=(\d+)/.exec(h) || [0, 0])[1], 10);
          void (async () => {
            const sl = (ms) => new Promise((r) => setTimeout(r, ms));
            for (let i = 0; i < n; i++) await nextStep();
            await sl(300);
            renderSelfCheck();
          })();
        }
        if (/interrupttest=1/.test(h) && !S.testRan_interrupt) {
          S.testRan_interrupt = true;
          void (async () => {
            const sl = (ms) => new Promise((r) => setTimeout(r, ms));
            const p = nextStep();                  // 开一个长动画
            await sl(300);
            resetAll();                            // 动画中途重设
            await sl(2500);                        // 等旧动画彻底结束
            await p.catch(() => {});
            document.body.setAttribute('data-interrupt', ['done',
              R.encode(S.state) === R.encode(R.solved()) ? 'reset-state' : 'stale-state',
              cube.querySelectorAll('.turn').length,
              document.querySelectorAll('.turn').length,
              el('btnNext').disabled ? 'disabled' : 'enabled'].join('|'));
          })();
        }
        if (/pncycle=(\d+)/.test(h) && !S.testRan_pncycle) {
          S.testRan_pncycle = true;
          const n = parseInt(/pncycle=(\d+)/.exec(h)[1], 10);
          void (async () => {
            const sl = (ms) => new Promise((r) => setTimeout(r, ms));
            await nextStep();                        // 先走一步
            for (let i = 0; i < n; i++) {            // 反复 上一步 → 下一步
              prevStep(); await sl(250);
              await nextStep(); await sl(250);
            }
            await sl(400);
            document.body.setAttribute('data-pncycle', ['done', S.cursor, R.encode(S.state),
              cube.querySelectorAll('.turn').length,
              document.querySelectorAll('.turn').length].join('|'));
          })();
        }
        if (/resettest=1/.test(h) && !S.testRan_resettest) { S.testRan_resettest = true;
          void (async () => {
            const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
            // 第一次填色 (打乱 A)
            const stA = R.applyAlg(R.solved(), ['R', 'U']);
            let fl = R.faceletsFromState(stA);
            for (let i = 0; i < 54; i++) PAINT.cells[i] = fl[i];
            renderPainter(); paintValidate();
            await sleep2(250);
            const afterA = R.encode(S.state);
            const stepsA = S.flat.length;
            // 点「重设」
            resetAll();
            await sleep2(150);
            const cleared = !S.plan && S.flat.length === 0;
            const uiReset = el('nextName').textContent.indexOf('未开始') >= 0;
            // 再填另一份 (打乱 B), 应完全按 B 计算
            const stB = R.applyAlg(R.solved(), ["F'", 'L2', 'D', 'B']);
            fl = R.faceletsFromState(stB);
            for (let i = 0; i < 54; i++) PAINT.cells[i] = fl[i];
            renderPainter(); paintValidate();
            await sleep2(300);
            const wantB = R.encode(R.stateFromFacelets(fl).state);
            document.body.setAttribute('data-resettest', ['done',
              cleared ? 'cleared' : 'notcleared',
              uiReset ? 'ui-reset' : 'ui-kept',
              R.encode(S.state) === wantB ? 'B-state' : (R.encode(S.state) === afterA ? 'A-state(stale)' : 'other'),
              'stepsA=' + stepsA, 'stepsB=' + S.flat.length, 'cursor=' + S.cursor,
              el('btnNext').disabled ? 'disabled' : 'enabled'].join('|'));
          })();
        }
        if (/paintnetcheck=1/.test(h) && !S.testRan_paintnetcheck) { S.testRan_paintnetcheck = true;
          void (async () => {
            const RGB2IDX = { 'rgb(244, 246, 248)': 0, 'rgb(255, 213, 0)': 1, 'rgb(0, 166, 81)': 2,
              'rgb(0, 81, 186)': 3, 'rgb(196, 30, 58)': 4, 'rgb(255, 140, 0)': 5 };
            const st = R.applyAlg(R.solved(), ['R', 'U', "F'", 'L2', 'D', 'B', "R'"]);
            const fl = R.faceletsFromState(st);
            for (let i = 0; i < 54; i++) PAINT.cells[i] = fl[i];
            renderPainter();
            paintValidate();
            await new Promise((r) => setTimeout(r, 400));
            let bad = [], checked = 0;
            PAINT_FACES.forEach((f, fi) => {
              for (let i = 0; i < 9; i++) {
                const dom = netCells[f][i].style.background;
                const idx = RGB2IDX[dom];
                checked++;
                if (idx !== PAINT.cells[fi * 9 + i]) bad.push(`${f}${i}: 填${PAINT.cells[fi * 9 + i]} 屏幕${idx}(${dom})`);
              }
            });
            document.body.setAttribute('data-paintnet',
              `done|${checked}|${bad.length}|${bad.slice(0, 6).join(' ; ')}`);
          })();
        }
        if (/reimportcycle=1/.test(h) && !S.testRan_reimportcycle) { S.testRan_reimportcycle = true;
          void (async () => {
            const p = nextStep();                       // 让一个动画正在跑
            await new Promise((r) => setTimeout(r, 400));
            // 模拟"重新手动填色 → 校验并开始还原"
            const fresh = R.applyAlg(R.solved(), ['R', 'U', "F'", 'L2', 'D']);
            const fl = R.faceletsFromState(fresh);
            for (let i = 0; i < 54; i++) PAINT.cells[i] = fl[i];
            renderPainter();
            paintValidate();
            await new Promise((r) => setTimeout(r, 700));
            await p.catch(() => {});
            const want = R.encode(R.stateFromFacelets(fl).state);
            document.body.setAttribute('data-reimport', ['done',
              S.animating ? 'anim' : 'idle',
              S.cursor,
              R.encode(S.state) === want ? 'newstate' : 'stale',
              el('btnNext').disabled ? 'disabled' : 'enabled'].join('|'));
          })();
        }
        if (/holdpause=1/.test(h) && !S.testRan_holdpause) { S.testRan_holdpause = true;
          void (async () => {
            const p = nextStep();
            await new Promise((r) => setTimeout(r, 400));
            setPaused(true);
            await p.catch(() => {});
          })();
        }
        const ab = /abortcycle=(\d+)/.exec(h);
        if (ab) {
          document.body.setAttribute('data-abortcycle', 'start');
          void (async () => {
            const n = parseInt(ab[1], 10);
            const before = R.encode(S.state);
            const p = nextStep();
            await new Promise((r) => setTimeout(r, 300));
            setPaused(true);
            await new Promise((r) => setTimeout(r, 200));
            prevStep();                                  // 暂停中 → 放弃本步
            await new Promise((r) => setTimeout(r, 300));
            const afterCursor = S.cursor;
            const animating = S.animating;
            const rolled = R.encode(S.state) === before;
            await p.catch(() => {});
            for (let i = 0; i < n; i++) await nextStep();  // 之后还能继续走
            document.body.setAttribute('data-abortcycle',
              ['done', afterCursor, animating ? 'anim' : 'idle', rolled ? 'rolled' : 'notrolled', S.cursor].join('|'));
          })();
        }
        const pc = /pausecycle=(\d+)/.exec(h);
        if (pc) {
          document.body.setAttribute('data-pausecycle', 'start');
          void (async () => {
            const n = parseInt(pc[1], 10);
            const p = nextStep();
            await new Promise((r) => setTimeout(r, 300));
            setPaused(true);
            const frozen = S.cursor + '|' + S.curMoveOfStep;
            await new Promise((r) => setTimeout(r, 700));
            const stillFrozen = (S.cursor + '|' + S.curMoveOfStep) === frozen;
            setPaused(false);
            await p;
            for (let i = 1; i < n; i++) await nextStep();
            document.body.setAttribute('data-pausecycle',
              'done|' + R.encode(S.state) + '|' + S.cursor + '|' + (stillFrozen ? 'frozen' : 'moved'));
          })();
        }
        const am = /auto=(\d+)/.exec(h);
        if (am) {
          document.body.setAttribute('data-autoplay', 'start');
          void (async () => {
            const n = parseInt(am[1], 10);
            for (let i = 0; i < n; i++) await nextStep();
            document.body.setAttribute('data-autoplay',
              'done|' + R.encode(S.state) + '|' + S.cursor);
          })();
        }
  }

  /** 载入导入的 54 格状态 */
  function importState(colors, label, opts) {
    const res = R.stateFromFacelets(colors);
    if (res.errors && res.errors.length) {
      el('importMsg').innerHTML = '<span style="color:#ff8080">✗ ' + res.errors.slice(0, 4).join('<br>✗ ')
        + (res.errors.length > 4 ? `<br>… 共 ${res.errors.length} 处问题` : '') + '</span>';
      return false;
    }
    const plan = R.buildPlanFromState(res.state, { scrambleMoves: [] });
    loadPlan(plan, label || '已导入你的魔方（54 格校验通过）', opts);
    el('importMsg').innerHTML = '<span style="color:var(--ok)">✓ 校验通过：颜色齐全、三个魔方不变量都合法。'
      + '请先和实物核对一遍再开始。</span>';
    S.rx = -26; S.ry = -36;                       // 回到标准 上/前/右, 便于和填色/实物对照
    if (S.mode3d) renderCube();
    toast('已载入你的魔方：共 ' + plan.totalMoves + ' 步（视角已回到 上/前/右）');
    return true;
  }

  /** 由打乱序列生成方案 (仅 #scr= 调试链接使用, 界面已无打乱功能) */
  function planFromScramble(scrambleMoves, label) {
    S.runToken++;                       // 中止正在进行的播放/动画
    S.playing = false; S.animating = false; S.paused = false; releasePause();
    el('nowMove').textContent = '';
    el('nextName').textContent = '计算中…';
    el('nextMoves').textContent = '';
    S.playing = false; S.animating = false;
    setTimeout(() => {
      try {
        const plan = R.buildPlan(scrambleMoves);
        const h = location.hash || '';
        loadPlan(plan, label || ('打乱 ' + scrambleMoves.join(' ')));
        const mv = /move=(\d+)/.exec(h);
        if (mv) { S.curMoveOfStep = parseInt(mv[1], 10); renderNext(); }
        // 调试: #auto=N 自动连点 N 次「下一步」(用于验证带动画的执行路径)
      } catch (e) {
        el('nextName').textContent = '生成失败：' + e.message;
        console.error(e.stack || e);
      }
    }, 20);
  }


  window.addEventListener('unhandledrejection', (e) => {
    document.body.setAttribute('data-reject', String((e.reason && e.reason.stack) || e.reason));
  });

  const BUILD = 'v6（移除拍照/打乱 · 只输入你的魔方）';

  // ================= 事件绑定 =================
  buildCubies();
  buildNet();
  buildViews();
  buildOrientSelect();
  renderFormulas();
  buildPalette();
  buildPainter();
  setMode(HAS3D);

  el('btnNext').onclick = nextStep;
  el('btnPrev').onclick = prevStep;
  el('btnPlayStage').onclick = playStage;
  el('btnPause').onclick = togglePause;
  el('btnPrint').onclick = () => window.open('roux-formulas-print.html', '_blank');
  el('btnPaintValidate').onclick = paintValidate;
  el('btnResetAll').onclick = resetAll;
  el('btnSelfCheck').onclick = renderSelfCheck;
  if (el('buildTag')) el('buildTag').textContent = BUILD;
  el('btnPaintSolved').onclick = paintSetSolved;
  el('btnPaintClear').onclick = () => {
    PAINT.cells.fill(-1);
    delete el('paintMsg').dataset.keep;
    renderPainter();
  };
  el('btnImport').onclick = () => {
    if (S.animating) return;
    const parsed = R.stringToFacelets(el('stateInput').value);
    if (parsed.error) {
      el('importMsg').innerHTML = '<span style="color:#ff8080">✗ ' + parsed.error + '</span>';
      toast('状态串有问题：' + parsed.error);
      return;
    }
    if (!importState(parsed.colors, undefined, { scroll: true, flash: true })) toast('校验没通过：请看红字说明');
  };
  el('btnExport').onclick = () => {
    const str = R.faceletsToString(R.faceletsFromState(S.state));
    el('stateInput').value = str;
    el('importMsg').innerHTML = '<span style="color:var(--ok)">✓ 已把当前屏幕状态按顺序填入（可直接复制保存）</span>';
  };
  el('btnClearInput').onclick = () => { el('stateInput').value = ''; el('importMsg').textContent = ''; };
  el('btn3d').onclick = () => setMode(true);
  el('btnNet').onclick = () => setMode(false);
  el('chkAuto').onchange = (e) => { S.auto = e.target.checked; };
  (function initChunk() {
    let saved = null;
    try { saved = localStorage.getItem('roux.maxPerStep'); } catch (e) { saved = null; }
    if (saved !== null && saved !== undefined) S.maxPerStep = Math.max(0, parseInt(saved, 10) || 0);
    const sel = el('selChunk');
    sel.value = String(S.maxPerStep);
    sel.onchange = () => {
      S.maxPerStep = Math.max(0, parseInt(sel.value, 10) || 0);
      try { localStorage.setItem('roux.maxPerStep', String(S.maxPerStep)); } catch (e) { /* ignore */ }
      applyChunkSetting();
      toast(S.maxPerStep ? `已按每步 ≤${S.maxPerStep} 转重新拆步` : '已改回整条公式');
    };
  }());

  (function initSpeed() {
    let saved = null;
    try { saved = parseFloat(localStorage.getItem('roux.moveSec')); } catch (err) { saved = null; }
    if (saved && saved >= 0.2 && saved <= 3) S.moveMs = Math.round(saved * 1000);
    const rng = el('rngSpd');
    rng.value = (S.moveMs / 1000).toFixed(1);
    el('spdVal').textContent = (S.moveMs / 1000).toFixed(1) + ' s';
    rng.oninput = () => {
      S.moveMs = Math.round(parseFloat(rng.value) * 1000);
      el('spdVal').textContent = (S.moveMs / 1000).toFixed(1) + ' s';
      try { localStorage.setItem('roux.moveSec', rng.value); } catch (err) { /* ignore */ }
    };
  }());
  el('chkAnim').onchange = (e) => { S.anim = e.target.checked; };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextStep(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevStep(); }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
  });

  // 启动: #scr=<打乱> 复现某一局; #cursor=N 跳到第 N 步之后; #vx/#vy 指定视角
  (function boot() {
    const h = location.hash || '';
    const vx = /vx=(-?\d+)/.exec(h), vy = /vy=(-?\d+)/.exec(h);
    if (vx) S.rx = parseInt(vx[1], 10);
    if (vy) S.ry = parseInt(vy[1], 10);
    if (vx || vy) { S.auto = false; el('chkAuto').checked = false; }
    if (/mode=net/.test(h)) setMode(false);
    const ck = /chunk=(\d+)/.exec(h);
    if (ck) S.maxPerStep = Math.max(0, parseInt(ck[1], 10) || 0);
    const sp = /spd=([\d.]+)/.exec(h);
    if (sp) S.moveMs = Math.max(20, Math.round(parseFloat(sp[1]) * 1000));
    if (/fast=1/.test(h)) S.fast = true;
    const pv = /paint=([WYGBROwygbro]+)/.exec(h);
    if (pv) {
      const parsed = R.stringToFacelets(pv[1]);
      if (!parsed.error) {
        for (let i = 0; i < 54; i++) PAINT.cells[i] = parsed.colors[i];
        renderPainter();
        paintValidate();
        tick();
        return;
      }
    }
    const st = /state=([WYGBROwygbro]+)/.exec(h);
    if (st) {
      const parsed = R.stringToFacelets(st[1]);
      if (!parsed.error) {
        el('stateInput').value = st[1].toUpperCase();
        importState(parsed.colors, '已从链接导入你的魔方');
        tick();
        return;
      }
    }
    const sm = /scr=([^&]+)/.exec(h);
    if (sm) {
      const r = parseScramble(decodeURIComponent(sm[1]).replace(/\+/g, ' '));
      if (!r.error) { planFromScramble(r.moves, '打乱 ' + r.moves.join(' ')); tick(); return; }
    }
    // 没有带参数: 从"未载入"开始 —— 请用下面的「手动填色」或粘贴状态串
    S.plan = null; S.flat = []; S.cursor = 0; S.curMoveOfStep = -1;
    S.state = R.solved();
    if (el('planLabel')) {
      el('planLabel').textContent = '当前：未载入 —— 在「手动填色」填满 54 格后点「校验并开始还原」，或粘贴状态串后点「解析并载入」';
    }
    paintAll();
    if (S.mode3d) renderCube();
    renderTabs(); renderNext(); renderStatus(); renderPlan();
    tick();
  }());
}());
