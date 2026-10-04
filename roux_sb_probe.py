#!/usr/bin/env python3
"""右桥 (Second Block) 最优解探针 (真实流程: 先解左桥, 再在 <U,R,M,r> 下解右桥).

右桥 = DFR, DRB 角块 + DR, FR, BR 棱块 (+ R 中心块)
"""
import random
import sys
import time
from collections import Counter

import roux_fb_probe as FP
import roux_feasibility_probe as R

SB_C = [4, 7]                     # DFR, DRB
SB_E = [8 + 4, 8 + 8, 8 + 11]     # DR, FR, BR
SB_ALL = SB_C + SB_E
FB_C = [5, 6]
FB_E = [8 + 6, 8 + 9, 8 + 10]

RESTRICTED = [b + s for b in ('U', 'R', 'M') for s in ('', '2', "'")] + ['r', 'r2', "r'"]


def apply_pattern(pattern, mv):
    if mv[0] != 'r':
        perm, ori = R.TB[mv]
        return tuple((perm[s], ori[(s, o)]) for (s, o) in pattern)
    sub = ['R', "M'"] if mv == 'r' else (['R2', 'M2'] if mv == 'r2' else ["R'", 'M'])
    st = pattern
    for m in sub:
        perm, ori = R.TB[m]
        st = tuple((perm[s], ori[(s, o)]) for (s, o) in st)
    return st


def apply_state(state, mv):
    if mv[0] != 'r':
        return R.apply(state, mv)
    sub = ['R', "M'"] if mv == 'r' else (['R2', 'M2'] if mv == 'r2' else ["R'", 'M'])
    for m in sub:
        state = R.apply(state, m)
    return state


def extract(state, pieces):
    cs, es = state
    pos_of = {}
    for pos, (c, o) in enumerate(cs):
        pos_of[('c', c)] = (pos, o)
    for pos, (c, o) in enumerate(es):
        pos_of[('e', c)] = (8 + pos, o)
    return tuple(pos_of[p] for p in pieces)


def fb_intact(state):
    cs, es = state
    return (all(cs[i] == (i, 0) for i in (5, 6))
            and all(es[i] == (i, 0) for i in (6, 9, 10)))


def build_pdb(pieces, moves):
    goal = tuple((i, 0) for i in pieces)
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


def make_solver(pdb_c, pdb_e, moves):
    def hh(st):
        return max(pdb_c[st[:len(SB_C)]] if len(st) == 5 else pdb_c[st[:2]],
                   pdb_e[st[len(SB_C):]] if len(st) == 5 else pdb_e[st[2:]])

    def dfs(st, g, thr, last, path):
        h = max(pdb_c[st[:2]], pdb_e[st[2:]])
        if g + h > thr:
            return g + h
        if h == 0:
            return True
        best = 1 << 30
        for mv in moves:
            if last and mv[0] == last[0]:
                continue
            path.append(mv)
            r = dfs(apply_pattern(st, mv), g + 1, thr, mv, path)
            if r is True:
                return True
            path.pop()
            if r < best:
                best = r
        return best

    def solve(st):
        thr = max(pdb_c[st[:2]], pdb_e[st[2:]])
        path = []
        while True:
            r = dfs(st, 0, thr, None, path)
            if r is True:
                return list(path)
            path.clear()
            thr = r

    return solve


def main(n=300):
    t0 = time.time()
    fb_pdb_c = build_pdb(FB_C, [m for m in R.MOVES if m[0] in 'UDLRFB'])
    fb_pdb_e = build_pdb(FB_E, [m for m in R.MOVES if m[0] in 'UDLRFB'])
    sb_pdb_c = build_pdb(SB_C, RESTRICTED)
    sb_pdb_e = build_pdb(SB_E, RESTRICTED)
    print(f'模式库: 左桥角 {len(fb_pdb_c)} / 左桥棱 {len(fb_pdb_e)} / '
          f'右桥角 {len(sb_pdb_c)} / 右桥棱 {len(sb_pdb_e)} 状态, '
          f'全部构建 {time.time()-t0:.2f}s', flush=True)

    fb_solve = make_solver(fb_pdb_c, fb_pdb_e, R.MOVES)
    sb_solve = make_solver(sb_pdb_c, sb_pdb_e, RESTRICTED)

    random.seed(7)
    fb_lens, sb_lens = [], []
    fails = 0
    t0 = time.time()
    for _ in range(n):
        s = R.SOLVED
        for _ in range(30):
            s = R.apply(s, random.choice(R.MOVES))
        fb_path = fb_solve(FP.extract(s, [('c', 5), ('c', 6), ('e', 6), ('e', 9), ('e', 10)]))
        for mv in fb_path:
            s = R.apply(s, mv)
        assert fb_intact(s), '左桥解完后左桥应为还原态'
        sb_path = sb_solve(extract(s, [('c', 4), ('c', 7), ('e', 4), ('e', 8), ('e', 11)]))
        if sb_path is None:
            fails += 1
            continue
        # 验证右桥确实被解出且左桥未被破坏
        s2 = s
        for mv in sb_path:
            s2 = apply_state(s2, mv)
        cs, es = s2
        assert all(cs[i] == (i, 0) for i in (4, 7)) and all(es[i] == (i, 0) for i in (4, 8, 11))
        assert fb_intact(s2)
        fb_lens.append(len(fb_path))
        sb_lens.append(len(sb_path))

    print(f'随机 {n} 例整链 (打乱 30 步 -> 解左桥 -> 解右桥):')
    print(f'  左桥最优: 最长 {max(fb_lens)}, 平均 {sum(fb_lens)/len(fb_lens):.2f} 步')
    print(f'  右桥最优(<U,R,M,r>): 最长 {max(sb_lens)}, 平均 {sum(sb_lens)/len(sb_lens):.2f} 步, '
          f'无解 {fails}')
    print('  右桥长度分布 =', dict(sorted(Counter(sb_lens).items())))
    print(f'  左桥+右桥合计平均 {sum(fb_lens)/len(fb_lens) + sum(sb_lens)/len(sb_lens):.2f} 步 (STM)')
    print(f'  总耗时 {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 300)
