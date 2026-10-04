#!/usr/bin/env python3
"""左桥全状态空间 BFS (12 个面转; M 不移动左桥任何块, 故与 18 转等价).

左桥 = DLF, DBL 角块 + DL, FL, BL 棱块 (+ L 中心块).
"""
import time
from collections import Counter

import roux_feasibility_probe as R

FB_C = [5, 6]
FB_E = [8 + 6, 8 + 9, 8 + 10]
FACE = [m for m in R.MOVES if m[0] in 'UDLRFB']


def apply_pattern(pattern, mv):
    perm, ori = R.TB[mv]
    return tuple((perm[s], ori[(s, o)]) for (s, o) in pattern)


def main():
    t0 = time.time()
    # 两个投影各自的完整状态空间 (BFS from goal)
    def proj(pieces):
        goal = tuple((i, 0) for i in pieces)
        dist = {goal: 0}
        frontier = [goal]
        d = 0
        while frontier:
            nxt = []
            for st in frontier:
                for mv in FACE:
                    ns = apply_pattern(st, mv)
                    if ns not in dist:
                        dist[ns] = d + 1
                        nxt.append(ns)
            frontier = nxt
            d += 1
        return dist

    pc = proj(FB_C)
    pe = proj(FB_E)
    cs_list = list(pc.keys())
    es_list = list(pe.keys())
    nc, ne = len(cs_list), len(es_list)
    ci = {s: i for i, s in enumerate(cs_list)}
    ei = {s: i for i, s in enumerate(es_list)}
    print(f'角块投影 {nc} 状态, 棱块投影 {ne} 状态, 联合上限 {nc*ne}', flush=True)

    N = nc * ne
    dist = bytearray(b'\xff' * N)
    start = ci[tuple((i, 0) for i in FB_C)] * ne + ei[tuple((i, 0) for i in FB_E)]
    dist[start] = 0
    frontier = [start]
    d = 0
    while frontier:
        nxt = []
        for idx in frontier:
            c = cs_list[idx // ne]
            e = es_list[idx % ne]
            for mv in FACE:
                k = ci[apply_pattern(c, mv)] * ne + ei[apply_pattern(e, mv)]
                if dist[k] == 255:
                    dist[k] = d + 1
                    nxt.append(k)
        frontier = nxt
        d += 1
        print(f'  深度 {d:2d}: 本层 {len(nxt)}', flush=True)
    reach = [i for i in range(N) if dist[i] != 255]
    hist = Counter(dist[i] for i in reach)
    print(f'左桥可达状态数 = {len(reach)} (联合空间 {N})')
    print(f'左桥最优解最长 = {max(hist)}, 平均 = '
          f'{sum(k*v for k,v in hist.items())/len(reach):.3f} 步')
    print('长度分布 =', dict(sorted(hist.items())))
    print(f'全表内存 = {N/1024/1024:.2f} MB (每状态 1 字节), 构建耗时 {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
