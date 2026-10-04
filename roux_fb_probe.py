#!/usr/bin/env python3
"""左桥 (First Block, 1x2x3) 最优解探针: 模式数据库 + IDA*.

左桥 = DLF, DBL 两个角块 + DL, FL, BL 三个棱块 (+ L 中心块)
"""
import random
import sys
import time
from collections import Counter

import roux_feasibility_probe as R

# 全局 slot: 角块 0-7, 棱块 8-19
FB_CORNERS = [5, 6]                     # DLF, DBL
FB_EDGES = [8 + 6, 8 + 9, 8 + 10]       # DL, FL, BL
FB_ALL = FB_CORNERS + FB_EDGES
HOME = {p: p for p in FB_ALL}


def apply_pattern(pattern, mv):
    """pattern: 被追踪块的 (slot, ori) 元组, 顺序固定."""
    perm, ori = R.TB[mv]
    return tuple((perm[s], ori[(s, o)]) for (s, o) in pattern)


def extract(state, pieces):
    """从完整状态抽出指定块的 (slot, ori)."""
    cs, es = state
    pos_of = {}
    for pos, (c, o) in enumerate(cs):
        pos_of[('c', c)] = (pos, o)
    for pos, (c, o) in enumerate(es):
        pos_of[('e', c)] = (8 + pos, o)
    out = []
    for kind, idx in pieces:
        out.append(pos_of[(kind, idx)])
    return tuple(out)


def build_pdb(pieces, moves):
    goal = tuple((HOME[8 + i] if kind == 'e' else HOME[i], 0) for kind, i in pieces)
    if not pieces:
        return {(): 0}
    dist = {goal: 0}
    frontier = [goal]
    d = 0
    while frontier:
        nxt = []
        for st in frontier:
            for mv in moves:
                ns = apply_pattern(st, mv)
                if ns not in dist:
                    dist[ns] = d + 1
                    nxt.append(ns)
        frontier = nxt
        d += 1
    return dist


def main(n=300):
    MOVES = R.MOVES
    t0 = time.time()
    pdb_c = build_pdb([('c', 5), ('c', 6)],
                      [m for m in MOVES if m[0] in 'UDLRFB'])
    pdb_e = build_pdb([('e', 6), ('e', 9), ('e', 10)],
                      [m for m in MOVES if m[0] in 'UDLRFB'])
    print(f'角块模式库 {len(pdb_c)} 状态 (最大距离 {max(pdb_c.values())}), '
          f'棱块模式库 {len(pdb_e)} 状态 (最大距离 {max(pdb_e.values())}), '
          f'构建耗时 {time.time()-t0:.2f}s', flush=True)

    def hh(st):
        return max(pdb_c[st[:2]], pdb_e[st[2:]])

    nodes = [0]

    def dfs(st, g, thr, last):
        nodes[0] += 1
        h = hh(st)
        if g + h > thr:
            return g + h
        if h == 0:
            return True
        best = 1 << 30
        for mv in MOVES:
            if last and mv[0] == last[0]:
                continue
            r = dfs(apply_pattern(st, mv), g + 1, thr, mv)
            if r is True:
                return True
            if r < best:
                best = r
        return best

    def solve(st):
        thr = hh(st)
        while True:
            r = dfs(st, 0, thr, None)
            if r is True:
                return thr
            thr = r

    random.seed(7)
    lens = []
    t0 = time.time()
    total_nodes = 0
    for _ in range(n):
        s = R.SOLVED
        for _ in range(30):
            s = R.apply(s, random.choice(MOVES))
        st = extract(s, [('c', 5), ('c', 6), ('e', 6), ('e', 9), ('e', 10)])
        nodes[0] = 0
        lens.append(solve(st))
        total_nodes += nodes[0]
    print(f'随机 {n} 例左桥最优解: 最长 {max(lens)} 步, 最短 {min(lens)} 步, '
          f'平均 {sum(lens)/len(lens):.2f} 步')
    print('长度分布 =', dict(sorted(Counter(lens).items())),
          f'| IDA* 平均展开 {total_nodes/n:.0f} 节点/例, 总耗时 {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 300)
