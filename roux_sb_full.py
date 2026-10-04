#!/usr/bin/env python3
"""右桥全状态空间 BFS: 在保持左桥的 <U,R,M,r> 转动集下, 右桥子问题的完整状态表.

右桥 = DFR, DRB 角块 + DR, FR, BR 棱块. 左桥视为已还原且全程不动.
"""
import time
from collections import Counter

from roux_sb_probe import RESTRICTED, SB_C, SB_E, apply_pattern, build_pdb


def main():
    t0 = time.time()
    pdb_c = build_pdb(SB_C, RESTRICTED)
    pdb_e = build_pdb(SB_E, RESTRICTED)
    corner_states = list(pdb_c.keys())
    edge_states = list(pdb_e.keys())
    nc, ne = len(corner_states), len(edge_states)
    ci = {s: i for i, s in enumerate(corner_states)}
    ei = {s: i for i, s in enumerate(edge_states)}
    print(f'角块投影 {nc} 状态, 棱块投影 {ne} 状态 -> 联合空间上限 {nc*ne}', flush=True)

    N = nc * ne
    dist = bytearray(b'\xff' * N)
    start = ci[tuple((i, 0) for i in SB_C)] * ne + ei[tuple((i, 0) for i in SB_E)]
    dist[start] = 0
    frontier = [start]
    d = 0
    while frontier:
        nxt = []
        for idx in frontier:
            c = corner_states[idx // ne]
            e = edge_states[idx % ne]
            for mv in RESTRICTED:
                k = ci[apply_pattern(c, mv)] * ne + ei[apply_pattern(e, mv)]
                if dist[k] == 255:
                    dist[k] = d + 1
                    nxt.append(k)
        frontier = nxt
        d += 1
        print(f'  深度 {d:2d}: 本层 {len(nxt)} 状态, 累计无访问 '
              f'{N - sum(1 for x in dist if x != 255)}', flush=True)
    reach = [i for i in range(N) if dist[i] != 255]
    hist = Counter(dist[i] for i in reach)
    print(f'右桥可达状态数 = {len(reach)} (联合空间 {N})')
    print(f'右桥最优解最长 = {max(hist)}, 平均 = '
          f'{sum(k*v for k,v in hist.items())/len(reach):.3f} 步')
    print('长度分布 =', dict(sorted(hist.items())))
    print(f'全表内存 = {N/1024/1024:.2f} MB (每状态 1 字节), 构建耗时 {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
