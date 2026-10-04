#!/usr/bin/env python3
"""Roux 教学工具可行性探针.

用真实 20 块魔方模型量化桥式四步各自的搜索空间:
  1. <M,U> 群大小 / LSE 全状态数 / LSE 最优解最大步数 (穷举 BFS, 可做全表)
  2. CMLL 角块状态数 / 模 AUF 等价类 / CO x CP 分类数
  3. 左桥 (1x2x3, 5 个可动块) 最优解抽样 (模式数据库 + IDA*)
"""
import random
import time
from collections import Counter, deque
from itertools import permutations, product

CORNER_POS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB']
EDGE_POS = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR']
POS = CORNER_POS + EDGE_POS
PIDX = {p: i for i, p in enumerate(POS)}
FACE_MOVES = ['U', 'D', 'R', 'L', 'F', 'B', 'M']


def coord(name):
    x = y = z = 0
    for ch in name:
        if ch == 'U':
            y = 1
        elif ch == 'D':
            y = -1
        elif ch == 'R':
            x = 1
        elif ch == 'L':
            x = -1
        elif ch == 'F':
            z = 1
        elif ch == 'B':
            z = -1
    return (x, y, z)


def normals(name):
    """位置法向量; 参考法向量恒为 index 0 (角块=U/D 面, 侧棱=F/B 面)."""
    x, y, z = coord(name)
    ns = []
    if y:
        ns.append((0, y, 0))
    elif z:
        ns.append((0, 0, z))
    if x:
        ns.append((x, 0, 0))
    if y and z:
        ns.append((0, 0, z))
    return ns


def rot(name, v):
    """标准记法: 顺时针 = 从该面外侧看, 即绕外法线 -90 度."""
    x, y, z = v
    return {'U': (-z, y, x), 'D': (z, y, -x), 'R': (x, z, -y), 'L': (x, -z, y),
            'F': (y, -x, z), 'B': (-y, x, z), 'M': (x, -z, y)}[name]


def in_layer(base, c):
    x, y, z = c
    return {'U': y == 1, 'D': y == -1, 'R': x == 1, 'L': x == -1,
            'F': z == 1, 'B': z == -1, 'M': x == 0}[base]


def build_tables():
    tab = {}
    nrm = {p: normals(p) for p in POS}
    for base in FACE_MOVES:
        for k, suf in ((1, ''), (2, '2'), (3, "'")):
            perm = list(range(20))
            ori = {}
            for i, p in enumerate(POS):
                c = coord(p)
                if not in_layer(base, c):
                    for oi in range(len(nrm[p])):
                        ori[(i, oi)] = oi
                    continue
                q = c
                for _ in range(k):
                    q = rot(base, q)
                j = PIDX[next(x for x in POS if coord(x) == q)]
                perm[i] = j
                for oi, n in enumerate(nrm[p]):
                    v = n
                    for _ in range(k):
                        v = rot(base, v)
                    ori[(i, oi)] = nrm[POS[j]].index(v)
            tab[base + suf] = (perm, ori)
    return tab


TB = build_tables()
MOVES = [m for base in FACE_MOVES for m in (base, base + '2', base + "'")]


def apply(state, mv):
    cs, es = state
    perm, ori = TB[mv]
    ncs = [None] * 8
    nes = [None] * 12
    for i in range(8):
        c, o = cs[i]
        ncs[perm[i]] = (c, ori[(i, o)])
    for i in range(8, 20):
        c, o = es[i - 8]
        nes[perm[i] - 8] = (c, ori[(i, o)])
    return (tuple(ncs), tuple(nes))


SOLVED = (tuple((i, 0) for i in range(8)), tuple((i, 0) for i in range(12)))


def key(state):
    cs, es = state
    a = 0
    for i in range(7, -1, -1):
        a = a * 24 + cs[i][0] * 3 + cs[i][1]
    b = 0
    for i in range(11, -1, -1):
        b = b * 24 + es[i][0] * 2 + es[i][1]
    return a + (b << 40)


def check_model():
    ok = []
    for mv in MOVES:
        s = SOLVED
        for _ in range(4):
            s = apply(s, mv)
        ok.append(s == SOLVED)
    s = SOLVED
    for _ in range(105):
        s = apply(apply(s, 'R'), "U'")
    ok.append(s == SOLVED)          # 经典事实: (R U') 的阶为 105
    s = SOLVED
    for _ in range(63):
        s = apply(apply(s, 'R'), 'U')
    ok.append(s == SOLVED)          # (R U) 的阶为 63
    s = SOLVED
    for _ in range(6):
        for mv in ('R', 'U', "R'", "U'"):
            s = apply(s, mv)
    ok.append(s == SOLVED)
    return all(ok)


def corners_solved(state):
    cs, _ = state
    return all(c == i and o == 0 for i, (c, o) in enumerate(cs))


def bfs(moves, cap=8_000_000):
    dist = {key(SOLVED): 0}
    frontier = [SOLVED]
    levels = []
    d = 0
    while frontier:
        levels.append(len(frontier))
        nxt = []
        for st in frontier:
            for mv in moves:
                ns = apply(st, mv)
                k = key(ns)
                if k not in dist:
                    dist[k] = d + 1
                    if len(dist) > cap:
                        return dist, levels, True
                    nxt.append(ns)
        frontier = nxt
        d += 1
    return dist, levels, False


def lse_analysis():
    lse_moves = ['M', 'M2', "M'", 'U', 'U2', "U'"]
    dist, levels, capped = bfs(lse_moves)
    d_lse = {}
    frontier = [SOLVED]
    seen = {key(SOLVED)}
    d = 0
    while frontier:
        for st in frontier:
            if corners_solved(st):
                d_lse[key(st)] = d
        nxt = []
        for st in frontier:
            for mv in lse_moves:
                ns = apply(st, mv)
                k = key(ns)
                if k not in seen:
                    seen.add(k)
                    nxt.append(ns)
        frontier = nxt
        d += 1
    return dist, levels, capped, d_lse


def cmll_analysis():
    states = []
    for perm in permutations(range(4)):
        for tw in product(range(3), repeat=4):
            if sum(tw) % 3 == 0:
                states.append(tuple(perm) + tuple(tw))
    orbits = set()
    co, cp = set(), set()
    for s in states:
        perm, tw = s[:4], s[4:]
        orbits.add(min(tuple(perm[(i + j) % 4] for i in range(4))
                        + tuple(tw[(i + j) % 4] for i in range(4)) for j in range(4)))
        co.add(min(tuple(tw[(i + j) % 4] for i in range(4)) for j in range(4)))
        cp.add(min(tuple(perm[(i + j) % 4] for i in range(4)) for j in range(4)))
    return len(states), len(orbits), co, cp


FBC = [5, 6]
FBE = [6, 9, 10]


def fb_state(state):
    cs, es = state
    return (tuple(cs[i] for i in FBC), tuple(es[i] for i in FBE))


def fb_apply(fb, mv):
    perm, ori = TB[mv]
    slots = [None] * 20
    for k, i in enumerate(FBC):
        slots[i] = fb[0][k]
    for k, i in enumerate(FBE):
        slots[8 + i] = fb[1][k]
    ns = [None] * 20
    for i in range(20):
        if slots[i] is not None:
            c, o = slots[i]
            ns[perm[i]] = (c, ori[(i, o)])
    return (tuple(ns[i] for i in FBC), tuple(ns[8 + i] for i in FBE))


def build_pdb(slots_c, slots_e):
    goal = (tuple((i, 0) for i in slots_c), tuple((i, 0) for i in slots_e))
    dist = {goal: 0}
    frontier = [goal]
    d = 0
    while frontier:
        nxt = []
        for fb in frontier:
            for mv in MOVES:
                ns = fb_apply(fb, mv)
                if ns not in dist:
                    dist[ns] = d + 1
                    nxt.append(ns)
        frontier = nxt
        d += 1
    return dist


def fb_analysis(n=300):
    pdb_c = build_pdb(FBC, [])
    pdb_e = build_pdb([], FBE)

    def hh(fb):
        return max(pdb_c[(fb[0], ())], pdb_e[((), fb[1])])

    stats = {'nodes': 0}

    def dfs(fb, g, thr):
        stats['nodes'] += 1
        h = hh(fb)
        if g + h > thr:
            return g + h
        if h == 0:
            return True
        best = 1 << 30
        for mv in MOVES:
            r = dfs(fb_apply(fb, mv), g + 1, thr)
            if r is True:
                return True
            best = min(best, r)
        return best

    def solve(fb):
        thr = hh(fb)
        while True:
            r = dfs(fb, 0, thr)
            if r is True:
                return thr
            thr = r

    random.seed(7)
    lens = []
    t0 = time.time()
    for _ in range(n):
        s = SOLVED
        for _ in range(30):
            s = apply(s, random.choice(MOVES))
        stats['nodes'] = 0
        lens.append(solve(fb_state(s)))
    return pdb_c, pdb_e, lens, time.time() - t0


def main():
    t0 = time.time()
    print('模型自检 (每个转动 4 次还原 / (R U)^105 / sexy^6):', check_model(),
          f'{time.time()-t0:.2f}s')

    t0 = time.time()
    dist, levels, capped, d_lse = lse_analysis()
    hist = Counter(d_lse.values())
    print(f'\n===== LSE (<M,U>) =====')
    print(f'<M,U> 群大小 = {len(dist)}  (触顶={capped})  层宽 = {levels}  {time.time()-t0:.2f}s')
    print(f'LSE 状态数(角块已还原) = {len(d_lse)}')
    print(f'LSE 最优解长度分布 = {dict(sorted(hist.items()))}')
    print(f'LSE 最优解最长 = {max(d_lse.values())} 步, 平均 = '
          f'{sum(k*v for k, v in hist.items())/len(d_lse):.2f} 步')
    print(f'整段计算耗时 = {time.time()-t0:.2f}s')

    n, orbits, co, cp = cmll_analysis()
    print(f'\n===== CMLL =====')
    print(f'U 层角块状态 (4! x 3^3, 含扭角约束) = {n}')
    print(f'模 AUF 等价类 = {orbits}')
    print(f'CO 型 (朝向, 模 AUF) = {len(co)} (含还原型) -> 非还原 {len(co)-1}')
    print(f'CP 型 (位置, 模 AUF) = {len(cp)}  -> {sorted(cp)}')
    print(f'CO x CP = {len(co)*len(cp)}  (社区标准 42 = 7 x 6, 另有含还原朝向的 6 条)')

    pdb_c, pdb_e, lens, dt = fb_analysis()
    print(f'\n===== 左桥 FB =====')
    print(f'角块模式库 {len(pdb_c)} 状态 (上界 {max(pdb_c.values())} 步), '
          f'棱块模式库 {len(pdb_e)} 状态 (上界 {max(pdb_e.values())} 步)')
    print(f'随机 {len(lens)} 例左桥最优解: 最长 {max(lens)}, 平均 {sum(lens)/len(lens):.2f} 步, '
          f'耗时 {dt:.1f}s')
    print('分布 =', dict(sorted(Counter(lens).items())))


if __name__ == '__main__':
    main()
