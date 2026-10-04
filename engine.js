/* engine.js — 桥式(Roux)教学引擎
 *
 * 标准记法: 每个面顺时针 = 从该面外侧看顺时针。
 * 坐标: x=R, y=U, z=F。状态 = 20 个块 + 6 个中心块。
 *
 * 提供:
 *   Roux.buildPlan(scrambleMoves) -> {stages:[{key,title,steps:[{name,moves,desc}]}], ...}
 *   Roux.solved / applyAlg / applyMove / isSolved / 阶段判定 / 取色(渲染)
 */
(function (root) {
  'use strict';

  // ---------- 几何 ----------
  const CORNER_POS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const EDGE_POS = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  const POS = CORNER_POS.concat(EDGE_POS);
  const PIDX = {};
  POS.forEach((p, i) => { PIDX[p] = i; });
  const FACE_SLOTS = ['U', 'D', 'F', 'B', 'R', 'L'];
  const FACE_IDX = {};
  FACE_SLOTS.forEach((f, i) => { FACE_IDX[f] = i; });

  function coord(name) {
    let x = 0, y = 0, z = 0;
    for (const ch of name) {
      if (ch === 'U') y = 1; else if (ch === 'D') y = -1;
      else if (ch === 'R') x = 1; else if (ch === 'L') x = -1;
      else if (ch === 'F') z = 1; else if (ch === 'B') z = -1;
    }
    return [x, y, z];
  }

  function normals(name) {
    const [x, y, z] = coord(name);
    const ns = [];
    if (y) ns.push([0, y, 0]); else if (z) ns.push([0, 0, z]);
    if (x) ns.push([x, 0, 0]);
    if (y && z) ns.push([0, 0, z]);
    return ns;
  }

  // 标准记法: 顺时针 = 从该面外侧看, 即绕外法线 -90 度
  function rotN(name, v) {
    const x = v[0], y = v[1], z = v[2];
    switch (name) {
      case 'U': return [-z, y, x];
      case 'D': return [z, y, -x];
      case 'R': return [x, z, -y];
      case 'L': return [x, -z, y];
      case 'F': return [y, -x, z];
      case 'B': return [-y, x, z];
      case 'M': return [x, -z, y];
    }
    throw new Error('bad move ' + name);
  }

  function inLayer(base, c) {
    const x = c[0], y = c[1], z = c[2];
    switch (base) {
      case 'U': return y === 1;
      case 'D': return y === -1;
      case 'R': return x === 1;
      case 'L': return x === -1;
      case 'F': return z === 1;
      case 'B': return z === -1;
      case 'M': return x === 0;
    }
    throw new Error('bad base ' + base);
  }

  const eq3 = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);

  const NORMALS = POS.map(normals);

  // ---------- 转动表 ----------
  const FACE_BASES = ['U', 'D', 'R', 'L', 'F', 'B', 'M'];

  function buildTables() {
    const tb = {};
    for (const base of FACE_BASES) {
      for (const [k, suf] of [[1, ''], [2, '2'], [3, "'"]]) {
        const perm = new Int8Array(20);
        const ori = new Int8Array(60);   // ori[slot*3 + o]
        const ct = new Int8Array(6);
        for (let i = 0; i < 20; i++) {
          const p = POS[i];
          const c = coord(p);
          if (!inLayer(base, c)) {
            perm[i] = i;
            const n = NORMALS[i].length;
            for (let o = 0; o < n; o++) ori[i * 3 + o] = o;
            continue;
          }
          let q = c;
          for (let s = 0; s < k; s++) q = rotN(base, q);
          let j = -1;
          for (let t = 0; t < 20; t++) if (eq3(coord(POS[t]), q)) { j = t; break; }
          perm[i] = j;
          const ns = NORMALS[i], ms = NORMALS[j];
          for (let o = 0; o < ns.length; o++) {
            let v = ns[o];
            for (let s = 0; s < k; s++) v = rotN(base, v);
            let oi = -1;
            for (let t = 0; t < ms.length; t++) if (eq3(ms[t], v)) { oi = t; break; }
            ori[i * 3 + o] = oi;
          }
        }
        // 中心块: 只有 M 类转动会置换中心
        for (let f = 0; f < 6; f++) {
          const c = coord(FACE_SLOTS[f]);
          if (!inLayer(base, c)) { ct[f] = f; continue; }
          let q = c;
          for (let s = 0; s < k; s++) q = rotN(base, q);
          let g = f;
          for (let t = 0; t < 6; t++) if (eq3(coord(FACE_SLOTS[t]), q)) { g = t; break; }
          ct[f] = g;
        }
        tb[base + suf] = { perm, ori, ct };
      }
    }
    return tb;
  }

  const TB = buildTables();
  const MOVES = [];
  for (const base of FACE_BASES) for (const suf of ['', '2', "'"]) MOVES.push(base + suf);
  const FACE_MOVES = MOVES.filter((m) => m[0] !== 'M');
  const LSE_MOVES = ['M', 'M2', "M'", 'U', 'U2', "U'"];
  // 保持左桥的转动集: U / R / M / r(=R M')
  const SB_MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'M', 'M2', "M'", 'r', 'r2', "r'"];
  const R_SUB = { r: ['R', "M'"], r2: ['R2', 'M2'], "r'": ["R'", 'M'] };

  // ---------- 状态 ----------
  function solvedState() {
    const cp = new Int8Array(8), co = new Int8Array(8);
    const ep = new Int8Array(12), eo = new Int8Array(12);
    const ct = new Int8Array(6);
    for (let i = 0; i < 8; i++) cp[i] = i;
    for (let i = 0; i < 12; i++) ep[i] = i;
    for (let i = 0; i < 6; i++) ct[i] = i;
    return { cp, co, ep, eo, ct };
  }

  function cloneState(s) {
    return {
      cp: s.cp.slice(), co: s.co.slice(),
      ep: s.ep.slice(), eo: s.eo.slice(), ct: s.ct.slice(),
    };
  }

  function applyMoveInPlace(s, mv) {
    if (R_SUB[mv]) {                    // 宽转动 r = R M'
      for (const sub of R_SUB[mv]) applyMoveInPlace(s, sub);
      return s;
    }
    const t = TB[mv];
    const perm = t.perm, ori = t.ori, ct = t.ct;
    const ncp = new Int8Array(8), nco = new Int8Array(8);
    for (let i = 0; i < 8; i++) { const j = perm[i]; ncp[j] = s.cp[i]; nco[j] = ori[i * 3 + s.co[i]]; }
    const nep = new Int8Array(12), neo = new Int8Array(12);
    for (let i = 0; i < 12; i++) {
      const j = perm[8 + i];
      nep[j - 8] = s.ep[i];
      neo[j - 8] = ori[(8 + i) * 3 + s.eo[i]];
    }
    const nct = new Int8Array(6);
    for (let i = 0; i < 6; i++) nct[ct[i]] = s.ct[i];
    s.cp = ncp; s.co = nco; s.ep = nep; s.eo = neo; s.ct = nct;
    return s;
  }

  function applyMove(s, mv) { return applyMoveInPlace(cloneState(s), mv); }

  function applyAlg(s, moves) {
    const out = cloneState(s);
    for (const mv of moves) applyMoveInPlace(out, mv);
    return out;
  }

  function encode(s) {
    const c = new Array(26);
    for (let i = 0; i < 8; i++) c[i] = String.fromCharCode(s.cp[i] * 3 + s.co[i]);
    for (let i = 0; i < 12; i++) c[8 + i] = String.fromCharCode(s.ep[i] * 2 + s.eo[i]);
    for (let i = 0; i < 6; i++) c[20 + i] = String.fromCharCode(s.ct[i]);
    return c.join('');
  }

  // ---------- 阶段判定 ----------
  const FB_C = [5, 6], FB_E = [6, 9, 10];
  const SB_C = [4, 7], SB_E = [4, 8, 11];
  const BLOCK_C = FB_C.concat(SB_C), BLOCK_E = FB_E.concat(SB_E);
  const LSE_E = [0, 1, 2, 3, 5, 7];

  const fbSolved = (s) => FB_C.every((i) => s.cp[i] === i && s.co[i] === 0)
    && FB_E.every((i) => s.ep[i] === i && s.eo[i] === 0);
  const sbSolved = (s) => SB_C.every((i) => s.cp[i] === i && s.co[i] === 0)
    && SB_E.every((i) => s.ep[i] === i && s.eo[i] === 0);
  const blocksSolved = (s) => fbSolved(s) && sbSolved(s);
  const cornersSolved = (s) => s.cp.every((c, i) => c === i && s.co[i] === 0);
  const eoSolved = (s) => LSE_E.every((i) => s.eo[i] === 0);
  const ulurSolved = (s) => s.ep[0] === 0 && s.ep[2] === 2;
  const centersSolved = (s) => s.ct.every((c, i) => c === i);
  const isSolved = (s) => cornersSolved(s) && s.ep.every((c, i) => c === i && s.eo[i] === 0)
    && centersSolved(s);
  const isScrambled = (s) => !isSolved(s);

  // ---------- 模式数据库 + IDA* ----------
  // piece: {kind:'c'|'e', idx} ; 位置用全局 slot (角 0-7, 棱 8-19)
  function homeSlot(pc) { return pc.kind === 'c' ? pc.idx : 8 + pc.idx; }

  function patternOf(s, pieces) {
    const out = new Int8Array(pieces.length * 2);
    for (let k = 0; k < pieces.length; k++) {
      const pc = pieces[k];
      if (pc.kind === 'c') {
        for (let i = 0; i < 8; i++) if (s.cp[i] === pc.idx) { out[2 * k] = i; out[2 * k + 1] = s.co[i]; break; }
      } else {
        for (let i = 0; i < 12; i++) if (s.ep[i] === pc.idx) { out[2 * k] = 8 + i; out[2 * k + 1] = s.eo[i]; break; }
      }
    }
    return out;
  }

  function applyPat(pat, mv) {
    if (R_SUB[mv]) {
      for (const sub of R_SUB[mv]) applyPat(pat, sub);
      return;
    }
    const t = TB[mv], perm = t.perm, ori = t.ori;
    for (let i = 0; i < pat.length; i += 2) {
      const sl = pat[i], o = pat[i + 1];
      pat[i] = perm[sl];
      pat[i + 1] = ori[sl * 3 + o];
    }
  }

  function patKey(pat, from, to) {
    let k = 0;
    for (let i = from; i < to; i++) {
      const sl = pat[2 * i], o = pat[2 * i + 1];
      // 角块: 8 槽 x 3 朝向 = 24; 棱块: 12 槽 x 2 朝向 = 24
      const v = sl >= 8 ? ((sl - 8) * 2 + o) : (sl * 3 + o);
      k = k * 24 + v;
    }
    return k;
  }

  function buildPdb(pieces, moves) {
    const n = pieces.length;
    const size = Math.pow(24, n);
    const dist = new Uint8Array(size).fill(255);
    const goal = new Int8Array(n * 2);
    for (let k = 0; k < n; k++) { goal[2 * k] = homeSlot(pieces[k]); goal[2 * k + 1] = 0; }
    const gk = patKey(goal, 0, n);
    dist[gk] = 0;
    let frontier = [goal];
    let d = 0;
    while (frontier.length) {
      const next = [];
      for (const pat of frontier) {
        for (const mv of moves) {
          const np = pat.slice();
          applyPat(np, mv);
          const key = patKey(np, 0, n);
          if (dist[key] === 255) { dist[key] = d + 1; next.push(np); }
        }
      }
      frontier = next;
      d++;
    }
    return dist;
  }

  function makeIdaSolver(pieces, moves, pdbC, pdbE, nCorner) {
    const n = pieces.length;
    const hOf = (pat) => Math.max(
      pdbC[patKey(pat, 0, nCorner)],
      pdbE[patKey(pat, nCorner, n)],
    );
    let nodes = 0;
    function dfs(pat, g, thr, lastFace, path) {
      nodes++;
      const h = hOf(pat);
      if (g + h > thr) return g + h;
      if (h === 0) return true;
      let best = Infinity;
      for (const mv of moves) {
        if (lastFace && mv[0] === lastFace) continue;
        const saved = pat.slice();
        applyPat(pat, mv);
        path.push(mv);
        const r = dfs(pat, g + 1, thr, mv[0], path);
        if (r === true) return true;
        path.pop();
        for (let i = 0; i < pat.length; i++) pat[i] = saved[i];
        if (r < best) best = r;
      }
      return best;
    }
    return function solve(state) {
      const pat = patternOf(state, pieces);
      nodes = 0;
      let thr = hOf(pat);
      const path = [];
      for (let guard = 0; guard < 40; guard++) {
        const r = dfs(pat, 0, thr, null, path);
        if (r === true) return { moves: path.slice(), nodes };
        if (r === Infinity) return null;
        thr = r;
      }
      return null;
    };
  }

  const FB_PIECES = [
    { kind: 'c', idx: 5 }, { kind: 'c', idx: 6 },
    { kind: 'e', idx: 6 }, { kind: 'e', idx: 9 }, { kind: 'e', idx: 10 },
  ];
  const SB_PIECES = [
    { kind: 'c', idx: 4 }, { kind: 'c', idx: 7 },
    { kind: 'e', idx: 4 }, { kind: 'e', idx: 8 }, { kind: 'e', idx: 11 },
  ];

  const PDB = {
    fbC: buildPdb(FB_PIECES.slice(0, 2), FACE_MOVES),
    fbE: buildPdb(FB_PIECES.slice(2), FACE_MOVES),
    sbC: buildPdb(SB_PIECES.slice(0, 2), SB_MOVES),
    sbE: buildPdb(SB_PIECES.slice(2), SB_MOVES),
  };
  const solveFBraw = makeIdaSolver(FB_PIECES, FACE_MOVES, PDB.fbC, PDB.fbE, 2);
  const solveSBraw = makeIdaSolver(SB_PIECES, SB_MOVES, PDB.sbC, PDB.sbE, 2);

  // ---------- CMLL: 三条公式 + AUF, 两阶段 ----------
  const SUNE = ['R', 'U', "R'", 'U', 'R', 'U2', "R'"];
  const ANTISUNE = ['R', 'U2', "R'", "U'", 'R', "U'", "R'"];
  const TPERM = ['R', 'U', "R'", "U'", "R'", 'F', 'R2', "U'", "R'", "U'", 'R', 'U', "R'", "F'"];
  const YPERM = ['F', 'R', "U'", "R'", "U'", 'R', 'U', "R'", "F'", 'R', 'U', "R'", "U'", "R'", 'F', 'R', 'F'];
  const AUF_GENS = [
    { name: 'AUF', moves: ['U'] }, { name: 'AUF', moves: ['U2'] }, { name: 'AUF', moves: ["U'"] },
  ];
  const OCLL_EXTRA = [
    { name: '小鱼（Sune）', moves: SUNE }, { name: '反小鱼（Antisune）', moves: ANTISUNE },
  ];
  const CPLL_EXTRA = [
    { name: 'T-perm', moves: TPERM }, { name: 'Y-perm', moves: YPERM },
  ];
  const OCLL_GENS = AUF_GENS.concat(OCLL_EXTRA);
  const CPLL_GENS = AUF_GENS.concat(CPLL_EXTRA);
  const CMLL_GENS = AUF_GENS.concat(OCLL_EXTRA, CPLL_EXTRA);

  function cornerKey(s) {
    let k = '';
    for (let i = 0; i < 8; i++) k += String.fromCharCode(s.cp[i] * 3 + s.co[i]);
    return k;
  }

  const CMLL = (function buildCmll() {
    const start = solvedState();
    const k0 = cornerKey(start);
    const idx = new Map([[k0, 0]]);
    const states = [start];
    const adj = [];
    const q = [0];
    while (q.length) {
      const i = q.shift();
      const row = {};
      for (let g = 0; g < CMLL_GENS.length; g++) {
        const ns = applyAlg(states[i], CMLL_GENS[g].moves);
        const k = cornerKey(ns);
        let j = idx.get(k);
        if (j === undefined) { j = states.length; idx.set(k, j); states.push(ns); q.push(j); }
        row[g] = j;
      }
      adj[i] = row;
    }
    return { idx, states, adj, gens: CMLL_GENS };
  })();

  function bfsPathByGens(adj, genIdxs, from, isGoal) {
    if (isGoal(from)) return [];
    const prev = new Map([[from, null]]);
    const queue = [from];
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      for (const gi of genIdxs) {
        const j = adj[i][gi];
        if (prev.has(j)) continue;
        prev.set(j, [i, gi]);
        if (isGoal(j)) {
          const path = [];
          let cur = j;
          while (prev.get(cur)) { const [p, gg] = prev.get(cur); path.push(gg); cur = p; }
          path.reverse();
          return path;
        }
        queue.push(j);
      }
    }
    return null;
  }

  const OCLL_IDX = OCLL_GENS.map((g) => CMLL_GENS.indexOf(g));
  const CPLL_IDX = CPLL_GENS.map((g) => CMLL_GENS.indexOf(g));
  const ALL_IDX = CMLL_GENS.map((g, i) => i);
  const movesOf = (gis) => gis.reduce((n, gi) => n + CMLL_GENS[gi].moves.length, 0);

  function solveCMLL(state) {
    const my = cornerKey(state);
    if (!CMLL.idx.has(my)) return null;
    const start = CMLL.idx.get(my);
    const solvedCorner = 0;                 // 状态 0 = 角块已还原
    const coDone = (i) => CMLL.states[i].co.every((o, k) => k >= 4 || o === 0);
    const toSteps = (gis) => gis.map((gi) => ({
      name: CMLL_GENS[gi].name, moves: CMLL_GENS[gi].moves.slice(), kind: 'formula',
    }));

    // 方案 A: 两阶段 (先朝向, 后换位) —— 更符合教学直觉
    let twoPhase = [];
    let cur = start;
    if (!coDone(cur)) {
      const sub = bfsPathByGens(CMLL.adj, OCLL_IDX, cur, coDone);
      if (!sub) return null;
      for (const gi of sub) { twoPhase.push(gi); cur = CMLL.adj[cur][gi]; }
    }
    if (cur !== solvedCorner) {
      const sub = bfsPathByGens(CMLL.adj, CPLL_IDX, cur, (i) => i === solvedCorner);
      if (!sub) return null;
      for (const gi of sub) { twoPhase.push(gi); cur = CMLL.adj[cur][gi]; }
    }

    // 方案 B: 一步搜索 (公式条数可能更少/更短)
    let onePhase = null;
    if (start !== solvedCorner) onePhase = bfsPathByGens(CMLL.adj, ALL_IDX, start, (i) => i === solvedCorner);

    if (onePhase && movesOf(onePhase) < movesOf(twoPhase)) return toSteps(onePhase);
    return toSteps(twoPhase);
  }

  // ---------- LSE: 最优解 (M/U 全表) + 里程碑标注 ----------
  const badEdgeCount = (s) => LSE_E.reduce((n, i) => n + (s.eo[i] ? 1 : 0), 0);

  let LSE_DIST = null;
  function lseDistTable() {
    if (LSE_DIST) return LSE_DIST;
    const goal = solvedState();
    const dist = new Map([[encode(goal), 0]]);
    const states = new Map([[encode(goal), goal]]);
    const queue = [encode(goal)];
    let head = 0;
    while (head < queue.length) {
      const k = queue[head++];
      const s = states.get(k);
      const d = dist.get(k);
      for (const mv of LSE_MOVES) {
        const ns = applyMove(s, mv);
        const nk = encode(ns);
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        states.set(nk, ns);
        queue.push(nk);
      }
    }
    LSE_DIST = dist;
    return dist;
  }

  function solveLSE(state) {
    const dist = lseDistTable();
    let s = cloneState(state);
    if (dist.get(encode(s)) === 0) return [];
    const path = [];
    for (let guard = 0; guard < 60; guard++) {
      const d = dist.get(encode(s));
      if (d === undefined) return null;
      if (d === 0) break;
      let bestS = null, bestMv = null, bestScore = null;
      for (const mv of LSE_MOVES) {
        const ns = applyMove(s, mv);
        if (dist.get(encode(ns)) !== d - 1) continue;
        const score = [badEdgeCount(ns), ulurSolved(ns) ? 0 : 1];
        if (!bestScore || score[0] < bestScore[0]
          || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
          bestScore = score; bestS = ns; bestMv = mv;
        }
      }
      if (!bestS) return null;
      path.push(bestMv);
      s = bestS;
    }
    if (dist.get(encode(s)) !== 0) return null;

    // 里程碑: 最早的 EO 完成点 / 最早的 EO+UL·UR 完成点
    let t = cloneState(state);
    let a = -1, b = -1;
    for (let i = 0; i < path.length; i++) {
      applyMoveInPlace(t, path[i]);
      if (a < 0 && eoSolved(t)) a = i + 1;
      if (a >= 0 && b < 0 && eoSolved(t) && ulurSolved(t)) b = i + 1;
    }
    if (a < 0) a = path.length;
    if (b < 0) b = path.length;
    if (b < a) b = a;
    const steps = [];
    if (a > 0) steps.push({ name: '4a 棱色相（EO）', moves: path.slice(0, a), kind: 'step', desc: '把 6 条棱的色相全部调正（只转 M / U）' });
    if (b > a) steps.push({ name: '4b 归位 UL·UR 棱', moves: path.slice(a, b), kind: 'step', desc: '把 UL、UR 两条棱放回正确位置' });
    if (b < path.length) steps.push({ name: '4c 归位 M 层', moves: path.slice(b), kind: 'step', desc: '还原 M 层的棱块与中心块' });
    // 退化保护: 如果里程碑没有把解法切开, 就按段展示
    if (steps.length === 1 && path.length > 4) {
      return chunkSteps(path, 4, 'LSE');
    }
    return steps;
  }

  // ---------- 拆步 ----------
  /** 把一组基础步骤再拆成"每步不超过 maxMoves 转"; maxMoves 为空则保持整条 */
  function stageChunks(baseSteps, maxMoves) {
    if (!maxMoves) return baseSteps.map((s) => ({
      name: s.name, moves: s.moves.slice(), kind: s.kind, desc: s.desc,
    }));
    const out = [];
    for (const bs of baseSteps) {
      const n = Math.ceil(bs.moves.length / maxMoves);
      if (n <= 1) {
        out.push({ name: bs.name, moves: bs.moves.slice(), kind: bs.kind, desc: bs.desc });
        continue;
      }
      for (let i = 0; i < n; i++) {
        const part = bs.moves.slice(i * maxMoves, (i + 1) * maxMoves);
        out.push({
          name: `${bs.name} · 第 ${i + 1}/${n} 段`,
          moves: part,
          kind: bs.kind,
          desc: `本段 ${part.length} 转：${part.join(' ')}`,
        });
      }
    }
    return out;
  }

  /** 按新的"每步最多转数"重新拆步 (总转动序列完全不变) */
  function rechunkPlan(plan, maxMoves) {
    if (!plan) return plan;
    for (const st of plan.stages) {
      if (!st.baseSteps) st.baseSteps = st.steps.map((x) => ({ ...x, moves: x.moves.slice() }));
      st.steps = stageChunks(st.baseSteps, maxMoves);
    }
    plan.maxPerStep = maxMoves || 0;
    plan.totalSteps = plan.stages.reduce((n, st) => n + st.steps.length, 0);
    return plan;
  }

  // ---------- 计划 ----------
  function chunkSteps(moves, size, title) {
    const out = [];
    for (let i = 0; i < moves.length; i += size) {
      const part = moves.slice(i, i + size);
      out.push({
        name: title + ' · 第 ' + (out.length + 1) + ' 段',
        moves: part,
        kind: 'step',
        desc: '本段 ' + part.length + ' 步：' + part.join(' '),
      });
    }
    return out;
  }

  const STAGE_TITLES = {
    fb: '左桥 (FB)',
    sb: '右桥 (SB)',
    cmll: '顶层角块 (CMLL)',
    lse: '剩余六棱 (LSE)',
  };

  /** 从任意合法状态出方案 (导入你自己的魔方时用) */
  function buildPlanFromState(startState, opts) {
    const verbose = opts && opts.verbose;
    const stages = [];
    let s = cloneState(startState);
    const scrambleState = cloneState(s);

    let t0 = Date.now();
    const fb = solveFBraw(s);
    if (!fb) throw new Error('左桥求解失败');
    s = applyAlg(s, fb.moves);
    if (!fbSolved(s)) throw new Error('左桥校验失败');
    const fbBase = chunkSteps(fb.moves, 4, '左桥');
    stages.push({
      key: 'fb', title: STAGE_TITLES.fb,
      baseSteps: fbBase, moves: fb.moves.slice(),
      steps: fbBase.map((x) => ({ ...x })),
      stat: { moves: fb.moves.length, nodes: fb.nodes, ms: Date.now() - t0 },
    });

    t0 = Date.now();
    const sb = solveSBraw(s);
    if (!sb) throw new Error('右桥求解失败');
    s = applyAlg(s, sb.moves);
    if (!blocksSolved(s)) throw new Error('右桥校验失败');
    const sbBase = chunkSteps(sb.moves, 5, '右桥');
    stages.push({
      key: 'sb', title: STAGE_TITLES.sb,
      baseSteps: sbBase, moves: sb.moves.slice(),
      steps: sbBase.map((x) => ({ ...x })),
      stat: { moves: sb.moves.length, nodes: sb.nodes, ms: Date.now() - t0 },
    });

    t0 = Date.now();
    const cmll = solveCMLL(s);
    if (!cmll) throw new Error('CMLL 求解失败');
    for (const st of cmll) s = applyAlg(s, st.moves);
    if (!cornersSolved(s) || !blocksSolved(s)) throw new Error('CMLL 校验失败');
    stages.push({
      key: 'cmll', title: STAGE_TITLES.cmll,
      baseSteps: cmll.map((x) => ({ ...x, moves: x.moves.slice() })),
      moves: cmll.reduce((acc, x) => acc.concat(x.moves), []),
      steps: cmll.map((x) => ({ ...x, moves: x.moves.slice() })),
      stat: { moves: cmll.reduce((n, st) => n + st.moves.length, 0), formulas: cmll.length, ms: Date.now() - t0 },
    });

    t0 = Date.now();
    const lse = solveLSE(s);
    if (lse === null) throw new Error('LSE 求解失败');
    for (const st of lse) s = applyAlg(s, st.moves);
    if (!isSolved(s)) throw new Error('LSE 校验失败');
    stages.push({
      key: 'lse', title: STAGE_TITLES.lse,
      baseSteps: lse.map((x) => ({ ...x, moves: x.moves.slice() })),
      moves: lse.reduce((acc, x) => acc.concat(x.moves), []),
      steps: lse.map((x) => ({ ...x, moves: x.moves.slice() })),
      stat: { moves: lse.reduce((n, st) => n + st.moves.length, 0), ms: Date.now() - t0 },
    });

    return {
      scrambleMoves: (opts && opts.scrambleMoves) || [],
      scrambleState,
      startState: scrambleState,
      stages,
      totalMoves: stages.reduce((n, st) => n + st.steps.reduce((m, x) => m + x.moves.length, 0), 0),
      verbose: verbose || null,
    };
  }

  /** 从打乱序列出方案 (内部先转成状态) */
  function buildPlan(scrambleMoves, opts) {
    return buildPlanFromState(applyAlg(solvedState(), scrambleMoves), opts);
  }

  // ---------- 打乱 ----------
  function randomScramble(len, rng) {
    const rand = rng || Math.random;
    const faces = ['U', 'D', 'R', 'L', 'F', 'B'];
    const opposite = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
    const out = [];
    let last = null, last2 = null;
    while (out.length < len) {
      const f = faces[Math.floor(rand() * 6)];
      if (f === last) continue;
      if (last2 === f && opposite[f] === last) continue;
      const suf = ["", "2", "'"][Math.floor(rand() * 3)];
      out.push(f + suf);
      last2 = last; last = f;
    }
    return out;
  }

  // ---------- 渲染取色 ----------
  // 视角约定 (与 CSS 3D 的 6 个面变换一致)
  const FACE_VIEW = {
    U: { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] },
    D: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
    F: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
    B: { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] },
    R: { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
    L: { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  };
  const COORD2POS = {};
  POS.forEach((p, i) => { COORD2POS[coord(p).join(',')] = i; });
  // ---------- 朝向 / 配色约定 ----------
  // 调色板索引固定: 0 白 1 黄 2 绿 3 蓝 4 红 5 橙
  // 每种朝向都是"标准配色整体转动若干角度"后的合法持法;
  // 只改面->颜色的标签, 不改几何与记法 (U/F/R 仍是几何上的上/前/右)。
  const FACE_DIR = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };
  const ORIENTATIONS = {
    'yellow-red': {
      name: '黄顶 · 红前（左桥蓝 / 右桥绿）',
      map: { U: 1, D: 0, F: 4, B: 5, R: 2, L: 3 },
    },
    'yellow-orange': {
      name: '黄顶 · 橙前（左桥绿 / 右桥蓝）',
      map: { U: 1, D: 0, F: 5, B: 4, R: 3, L: 2 },
    },
    'yellow-green': {
      name: '黄顶 · 绿前（左桥红 / 右桥橙）',
      map: { U: 1, D: 0, F: 2, B: 3, R: 5, L: 4 },
    },
  };
  let ORIENT_KEY = 'yellow-red';                       // 默认: 左右桥 = 蓝 / 绿
  let FACE_COLOR = ORIENTATIONS[ORIENT_KEY].map;
  const DIR2COLOR = {};
  function applyOrientation() {
    for (const [f, c] of Object.entries(FACE_COLOR)) DIR2COLOR[FACE_DIR[f].join(',')] = c;
  }
  applyOrientation();

  function setOrientation(key) {
    if (!ORIENTATIONS[key]) return false;
    ORIENT_KEY = key;
    FACE_COLOR = ORIENTATIONS[key].map;
    applyOrientation();
    return true;
  }
  function getOrientation() {
    const preset = ORIENTATIONS[ORIENT_KEY];
    return { key: ORIENT_KEY, name: preset ? preset.name : orientationLabel(), map: FACE_COLOR };
  }

  /** 返回某个面的 9 个贴纸颜色索引 (0=U白 1=D黄 2=F绿 3=B蓝 4=R红 5=L橙) */
  function faceColors(s, face) {
    const v = FACE_VIEW[face];
    const out = new Array(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) { out[row * 3 + col] = FACE_COLOR[FACE_SLOTS[s.ct[FACE_IDX[face]]]]; continue; }
        const P = [
          v.n[0] + v.r[0] * (col - 1) + v.u[0] * (1 - row),
          v.n[1] + v.r[1] * (col - 1) + v.u[1] * (1 - row),
          v.n[2] + v.r[2] * (col - 1) + v.u[2] * (1 - row),
        ];
        const pi = COORD2POS[P.join(',')];
        if (pi === undefined) { out[row * 3 + col] = -1; continue; }
        const kind = pi < 8 ? 'c' : 'e';
        const home = kind === 'c' ? CORNER_POS : EDGE_POS;
        const slotName = POS[pi], cubie = kind === 'c' ? s.cp[pi] : s.ep[pi - 8];
        const ori = kind === 'c' ? s.co[pi] : s.eo[pi - 8];
        const uNs = normals(home[cubie]);
        const pNs = normals(slotName);
        const k = pNs.findIndex((n) => eq3(n, v.n));
        let stickerIdx;
        if (kind === 'e') {
          stickerIdx = (k === ori) ? 0 : 1;
        } else {
          const hand = det3(uNs[0], uNs[1], uNs[2]);
          let j = -1;
          for (let c = 0; c < 3; c++) {
            if (c === ori) continue;
            const third = 3 - ori - c;
            if (det3(pNs[ori], pNs[c], pNs[third]) * hand > 0) { j = c; break; }
          }
          const g = [ori, j, 3 - ori - j];        // g[i] = 该贴纸所在的当前位置法线序号
          stickerIdx = g.indexOf(k);
        }
        out[row * 3 + col] = DIR2COLOR[uNs[stickerIdx].join(',')];
      }
    }
    return out;
  }

  function stateAfter(plan, stageIdx, stepIdx) {
    let s = cloneState(plan.scrambleState);
    for (let i = 0; i < plan.stages.length; i++) {
      const st = plan.stages[i];
      for (let j = 0; j < st.steps.length; j++) {
        if (i > stageIdx || (i === stageIdx && j >= stepIdx)) return s;
        s = applyAlg(s, st.steps[j].moves);
      }
    }
    return s;
  }


  // ---------- 渲染助手 (cubie 拼装用) ----------
  /** 返回 {"x,y,z|dx,dy,dz": colorIndex} —— 每个小方块每个方向上的贴纸颜色 */
  function stickerMap(state) {
    const map = {};
    for (const f of FACE_SLOTS) {
      const cols = faceColors(state, f);
      const v = FACE_VIEW[f];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const P = [
            v.n[0] + v.r[0] * (col - 1) + v.u[0] * (1 - row),
            v.n[1] + v.r[1] * (col - 1) + v.u[1] * (1 - row),
            v.n[2] + v.r[2] * (col - 1) + v.u[2] * (1 - row),
          ];
          map[P.join(',') + '|' + v.n.join(',')] = cols[row * 3 + col];
        }
      }
    }
    return map;
  }

  /** 把某个坐标按转动旋转 (用于 cubie 层的动画后重新定位) */
  function rotateCoord(mv, c) {
    if (R_SUB[mv]) {
      let out = c;
      for (const sub of R_SUB[mv]) out = rotateCoord(sub, out);
      return out;
    }
    const base = mv[0];
    const times = mv.length > 1 ? (mv[1] === '2' ? 2 : 3) : 1;
    if (!inLayer(base, c)) return c.slice();
    let out = c.slice();
    for (let i = 0; i < times; i++) out = rotN(base, out);
    return out;
  }

  // ---------- 动画用的 CSS 旋转 ----------
  // 约定: 模型坐标 (x 右, y 上, z 前) 映射到 CSS 为 (x, -y, z), 即 CSS = S·模型·S, S=diag(1,-1,1)
  //       CSS 的 rotateX/Y/Z 正方向为右手法则 (x 右, y 下, z 朝观察者)
  //       故 CSS 角度 = -模型角度, 轴 = S·n
  // 每个面的外法线: U=+y D=-y F=+z B=-z R=+x L=-x; 顺时针 = 绕外法线 -90°
  const CSS_AXIS = { U: ['Y', -1], D: ['Y', 1], R: ['X', 1], L: ['X', -1],
                     F: ['Z', 1], B: ['Z', -1], M: ['X', -1], r: ['X', 1] };

  /** 把转动变成 CSS 变换字符串 (rotateX/rotateY/rotateZ) */
  function cssRotation(mv) {
    const ax = CSS_AXIS[mv[0]];
    if (!ax) return 'rotate3d(0,0,1,0deg)';
    const times = mv.length > 1 ? (mv[1] === '2' ? 2 : -1) : 1;
    return `rotate${ax[0]}(${90 * times * ax[1]}deg)`;
  }

  /** 某个转动会影响哪些坐标 (层判定) */
  function inMoveLayer(mv, c) {
    const base = mv[0];
    if (R_SUB[mv]) return keyInSub(mv, c);
    return inLayer(base, c);
  }
  function keyInSub(mv, c) {
    const subs = R_SUB[mv];
    // r 系列 = R + M'，两次判定都要满足才会动 (实际上 R 或 M 只要有一个动就会动)
    return subs.some((sub) => inLayer(sub[0], c));
  }

  const COLORS_FACE_OF_DIR = DIR2COLOR;


  // ---------- 任意持法: 由 (顶面色, 前面色) 导出面->颜色标签 ----------
  const ALL_FACES = ['U', 'D', 'F', 'B', 'R', 'L'];
  const CANON_COLOR = { U: 0, D: 1, F: 2, B: 3, R: 4, L: 5 };   // 标准配色: U白 D黄 F绿 B蓝 R红 L橙
  const COLOR_LETTERS = ['W', 'Y', 'G', 'B', 'R', 'O'];
  const PIECE_OF_COLOR = [];                                    // 颜色 -> 拥有它的面 (标准配色下)
  ALL_FACES.forEach((f) => { PIECE_OF_COLOR[CANON_COLOR[f]] = f; });
  const IS_OPPOSITE = (a, b) => (a ^ 1) === b;
  const FACE_DIR_KEY = {};
  ALL_FACES.forEach((f) => { FACE_DIR_KEY[FACE_DIR[f].join(',')] = f; });

  const ROTATIONS_24 = (function () {
    // 用方向向量生成 24 个旋转, 再转成"面 -> 面"的置换
    const dirs = ALL_FACES.map((f) => FACE_DIR[f]);
    const faceOfDir = (v) => ALL_FACES.find((f) => FACE_DIR[f][0] === v[0] && FACE_DIR[f][1] === v[1] && FACE_DIR[f][2] === v[2]);
    const gen = [
      (v) => [v[0], -v[2], v[1]],
      (v) => [v[2], v[1], -v[0]],
      (v) => [-v[1], v[0], v[2]],
    ];
    const key = (perm) => perm.join('');
    const seen = new Map();
    const id = ALL_FACES.slice();
    seen.set(key(id), id);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      for (const g of gen) {
        // cur[f] = 该旋转把面 f 送到哪个面; 组合 g∘cur
        const next = ALL_FACES.map((f) => faceOfDir(g(FACE_DIR[cur[ALL_FACES.indexOf(f)]])));
        if (!seen.has(key(next))) { seen.set(key(next), next); queue.push(next); }
      }
    }
    return Array.from(seen.values());
  }());

  /** 由 24 个旋转建立 (顶面色, 前面色) -> 面->颜色 映射 */
  const ORIENT_BY_COLORS = (function () {
    const table = {};
    for (const g of ROTATIONS_24) {
      // g[f] = 面 f 上的颜色取自标准配色中的哪个面
      const colorAt = {};
      ALL_FACES.forEach((f) => { colorAt[f] = CANON_COLOR[g[ALL_FACES.indexOf(f)]]; });
      const k = colorAt.U + ',' + colorAt.F;
      table[k] = colorAt;
    }
    return table;
  }());

  function colorName(idx) {
    return ['白', '黄', '绿', '蓝', '红', '橙'][idx] || '?';
  }

  /** 设定任意持法: top/front 用颜色索引 (0白 1黄 2绿 3蓝 4红 5橙) */
  function setOrientationByColors(top, front) {
    if (IS_OPPOSITE(top, front)) return false;          // 顶面与前面不能是相对色
    const map = ORIENT_BY_COLORS[top + ',' + front];
    if (!map) return false;
    ORIENT_KEY = 'custom';
    FACE_COLOR = { U: map.U, D: map.D, F: map.F, B: map.B, R: map.R, L: map.L };
    applyOrientation();
    return true;
  }

  function orientationLabel() {
    const cn = colorName;
    return `${cn(FACE_COLOR.U)}顶 · ${cn(FACE_COLOR.F)}前 · 左桥${cn(FACE_COLOR.L)} / 右桥${cn(FACE_COLOR.R)} · 底${cn(FACE_COLOR.D)}`;
  }

  // ---------- 54 张贴纸的导入 / 导出 ----------
  // 顺序: 上 U / 左 L / 前 F / 右 R / 后 B / 下 D, 每面 9 格从左到右、从上到下
  const NET_FACES = ['U', 'L', 'F', 'R', 'B', 'D'];
  const NET_ORDER = (function () {
    const out = [];
    for (const f of NET_FACES) {
      const v = FACE_VIEW[f];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const P = [
            v.n[0] + v.r[0] * (col - 1) + v.u[0] * (1 - row),
            v.n[1] + v.r[1] * (col - 1) + v.u[1] * (1 - row),
            v.n[2] + v.r[2] * (col - 1) + v.u[2] * (1 - row),
          ];
          const entry = { face: f, coord: P, key: P.join(',') + '|' + v.n.join(','), row, col };
          if (row === 1 && col === 1) entry.center = true;
          else {
            const pi = COORD2POS[P.join(',')];
            entry.pos = pi;
            entry.nrm = NORMALS[pi].findIndex((n) => eq3(n, v.n));
          }
          out.push(entry);
        }
      }
    }
    return out;
  }());

  /** 状态 -> 54 个颜色索引 (net 顺序) */
  function faceletsFromState(state) {
    const map = stickerMap(state);
    return NET_ORDER.map((e) => (map[e.key] === undefined ? -1 : map[e.key]));
  }

  const isSideFace = (name) => !NORMALS[POS.indexOf(name)].some((n) => n[1] !== 0);
  const hasUD = (name) => name.indexOf('U') >= 0 || name.indexOf('D') >= 0;

  /** 当前朝向下: 标准面 -> 显示颜色 / 反向查表 */
  const colorOfFace = (f) => FACE_COLOR[f];
  const pieceOfColor = {};
  ALL_FACES.forEach((f) => { pieceOfColor[colorOfFace(f)] = f; });

  /** 54 个颜色索引 -> 状态 (含完整合法性校验) */
  function stateFromFacelets(colors, opts) {
    const errors = [];
    const warnings = [];
    const cnt = [0, 0, 0, 0, 0, 0];
    for (const c of colors) {
      if (c < 0 || c > 5) { errors.push('有贴纸没有颜色'); break; }
      cnt[c]++;
    }
    for (let i = 0; i < 6; i++) {
      if (cnt[i] !== 9) errors.push(`${COLOR_LETTERS[i]}(${colorName(i)}) 出现 ${cnt[i]} 次，应为 9 次`);
    }
    if (errors.length) return { state: null, errors, warnings };

    // 颜色查找表: colorAt[pos*3 + nrm]
    const colorAt = new Int8Array(60).fill(-1);
    NET_ORDER.forEach((e, i) => { if (!e.center) colorAt[e.pos * 3 + e.nrm] = colors[i]; });

    const s = solvedState();
    // 中心块
    for (let fi = 0; fi < 6; fi++) {
      const f = NET_FACES[fi];
      const c = colors[fi * 9 + 4];
      s.ct[FACE_IDX[f]] = ALL_FACES.indexOf(pieceOfColor[c]);
    }
    if (new Set(Array.from(s.ct)).size !== 6) errors.push('六个面的中心颜色有重复，无法确定朝向');

    // 角块 / 棱块 的颜色指纹表
    const cornerByKey = {};
    CORNER_POS.forEach((name, i) => {
      cornerByKey[normals(name).map((n) => colorOfFace(FACE_DIR_KEY[n.join(',')])).sort().join('')] = i;
    });
    const edgeByKey = {};
    EDGE_POS.forEach((name, i) => {
      edgeByKey[normals(name).map((n) => colorOfFace(FACE_DIR_KEY[n.join(',')])).sort().join('')] = i;
    });

    const usedCorner = new Set(), usedEdge = new Set();
    for (let p = 0; p < 8; p++) {
      const cs = [colorAt[p * 3], colorAt[p * 3 + 1], colorAt[p * 3 + 2]];
      if (cs.some((c) => c < 0)) { errors.push(`${CORNER_POS[p]} 位置有贴纸缺失`); continue; }
      const key = cs.slice().sort().join('');
      const piece = cornerByKey[key];
      if (piece === undefined) { errors.push(`${CORNER_POS[p]} 的三个颜色 (${cs.map(colorName).join('/')}) 不是真实角块`); continue; }
      if (usedCorner.has(piece)) { errors.push(`角块 ${CORNER_POS[piece]} 出现了两次`); continue; }
      usedCorner.add(piece);
      s.cp[p] = piece;
      const udColor = colorOfFace(CORNER_POS[piece].indexOf('D') >= 0 ? 'D' : 'U');
      s.co[p] = cs.indexOf(udColor);
      if (s.co[p] < 0) { errors.push(`${CORNER_POS[p]} 缺少黄/白贴纸`); }
    }
    for (let p = 0; p < 12; p++) {
      const cs = [colorAt[(8 + p) * 3], colorAt[(8 + p) * 3 + 1]];
      if (cs.some((c) => c < 0)) { errors.push(`${EDGE_POS[p]} 位置有贴纸缺失`); continue; }
      const key = cs.slice().sort().join('');
      const piece = edgeByKey[key];
      if (piece === undefined) { errors.push(`${EDGE_POS[p]} 的两个颜色 (${cs.map(colorName).join('/')}) 不是真实棱块`); continue; }
      if (usedEdge.has(piece)) { errors.push(`棱块 ${EDGE_POS[piece]} 出现了两次`); continue; }
      usedEdge.add(piece);
      s.ep[p] = piece;
      const nm = EDGE_POS[piece];
      const refFace = nm.indexOf('U') >= 0 ? 'U' : (nm.indexOf('D') >= 0 ? 'D' : (nm.indexOf('F') >= 0 ? 'F' : 'B'));
      s.eo[p] = cs.indexOf(colorOfFace(refFace));
      if (s.eo[p] < 0) { errors.push(`${EDGE_POS[p]} 缺少参考色贴纸`); }
    }
    const partial = { cp: s.cp, ep: s.ep, co: s.co, eo: s.eo, ct: s.ct };
    if (errors.length) return { state: partial, errors, warnings, partial: true };

    // ---- 三个魔方不变量 ----
    const par = (arr) => {
      const p = Array.from(arr); let sw = 0;
      for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]; const t = p[i]; p[i] = p[j]; p[j] = t; sw ^= 1; }
      return sw;
    };
    if (par(s.cp) !== par(s.ep)) errors.push('角块与棱块的奇偶性不一致（大概是某两个贴纸读反了）');
    // 角块扭角和 (按位置手性校正) == 0 mod 3
    let twist = 0;
    for (let p = 0; p < 8; p++) {
      const ns = NORMALS[p];
      const hand = det3(ns[0], ns[1], ns[2]);
      twist += hand > 0 ? s.co[p] : (3 - s.co[p]) % 3;
    }
    if (twist % 3 !== 0) errors.push('角块扭角和不合法（某一块的贴纸读错了）');
    // 棱块翻转和 == 0 mod 2
    let flip = 0;
    for (let p = 0; p < 12; p++) {
      const posSide = isSideFace(EDGE_POS[p]);
      const cubSide = !hasUD(EDGE_POS[s.ep[p]]);
      flip ^= s.eo[p] ^ ((posSide !== cubSide) ? 1 : 0);
    }
    if (flip % 2 !== 0) errors.push('棱块翻转数不合法（某一条棱读反了）');
    return { state: errors.length ? partial : s, errors, warnings, partial: errors.length > 0 };
  }

  /** 便于阅读的 net 字符串 (W/Y/G/B/R/O x 54) */
  function faceletsToString(colors) {
    return colors.map((c) => COLOR_LETTERS[c] || '?').join('');
  }
  function stringToFacelets(str) {
    const letters = { W: 0, Y: 1, G: 2, B: 3, R: 4, O: 5 };
    const s = str.toUpperCase().replace(/[^WYGBRO]/g, '');
    if (s.length !== 54) return { error: `需要 54 个字母 (W/Y/G/B/R/O)，现在解析出 ${s.length} 个` };
    return { colors: Array.from(s, (ch) => letters[ch]) };
  }

  // ---------- 自测 ----------
  function selfTest(n, seed) {
    let rng = seed === undefined ? Math.random : (function (x) {
      let s = x >>> 0;
      return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    })(seed);
    const stats = { fb: [], sb: [], cmllF: [], lse: [], total: [], ms: [] };
    let ok = 0, fails = 0, firstError = null;
    for (let i = 0; i < n; i++) {
      try {
        const scr = randomScramble(25, rng);
        const t0 = Date.now();
        const plan = buildPlan(scr);
        const ms = Date.now() - t0;
        // 逐步复演, 校验每个阶段的边界
        let s = plan.scrambleState;
        for (const st of plan.stages) {
          for (const step of st.steps) s = applyAlg(s, step.moves);
          if (st.key === 'fb' && !fbSolved(s)) throw new Error('FB 边界不满足');
          if (st.key === 'sb' && !blocksSolved(s)) throw new Error('SB 边界不满足');
          if (st.key === 'cmll' && !(cornersSolved(s) && blocksSolved(s))) throw new Error('CMLL 边界不满足');
          if (st.key === 'lse' && !isSolved(s)) throw new Error('LSE 边界不满足');
        }
        if (!isSolved(s)) throw new Error('最终未还原');
        if (plan.totalMoves > 95) throw new Error('步数异常 ' + plan.totalMoves);
        stats.fb.push(plan.stages[0].stat.moves);
        stats.sb.push(plan.stages[1].stat.moves);
        stats.cmllF.push(plan.stages[2].steps.length);
        stats.lse.push(plan.stages[3].stat.moves);
        stats.total.push(plan.totalMoves);
        stats.ms.push(ms);
        ok++;
      } catch (e) {
        fails++;
        if (!firstError) firstError = e.message;
      }
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
    return {
      ok, fails, firstError,
      avgFB: avg(stats.fb), avgSB: avg(stats.sb), avgCMLLformulas: avg(stats.cmllF),
      avgLSE: avg(stats.lse), avgTotal: avg(stats.total), avgMs: avg(stats.ms),
      maxMs: Math.max.apply(null, stats.ms.concat([0])),
      maxTotal: Math.max.apply(null, stats.total.concat([0])),
    };
  }

  function hOfDebug(pat) {
    return Math.max(PDB.fbC[patKey(pat, 0, 2)], PDB.fbE[patKey(pat, 2, 5)]);
  }

  root.Roux = {
    // 状态
    solved: solvedState, cloneState, applyMove, applyAlg, encode,
    faceColors, stateAfter, stickerMap, rotateCoord, inMoveLayer, cssRotation, CSS_AXIS,
    setOrientation, getOrientation, ORIENTATIONS, setOrientationByColors, orientationLabel,
    faceletsFromState, stateFromFacelets, faceletsToString, stringToFacelets,
    COLOR_LETTERS, colorName, NET_FACES, NET_ORDER, CANON_COLOR,
    // 判定
    fbSolved, sbSolved, blocksSolved, cornersSolved, eoSolved, ulurSolved, isSolved, isScrambled,
    // 求解
    buildPlan, buildPlanFromState, randomScramble, solveCMLL, solveLSE, rechunkPlan, stageChunks,
    chunkSteps, MOVES, SUNE, ANTISUNE, TPERM, YPERM,
    // 测试
    selfTest,
    _internals: { PDB, patKey, patternOf, hOfDebug, FB_PIECES, SB_PIECES, solveFBraw, solveSBraw, cornerKey, CMLL },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Roux;
}(typeof globalThis !== 'undefined' ? globalThis : this));
