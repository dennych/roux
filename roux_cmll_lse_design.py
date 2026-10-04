#!/usr/bin/env python3
"""CMLL 两阶段(先朝向 OCLL, 后换位 CPLL)完备性 + LSE 4a/4b/4c 分段长度."""
from collections import Counter, deque
from itertools import permutations, product

import roux_feasibility_probe as R
from roux_cmll_algs import ANTISUNE, SUNE, TPERM, YPERM, apply_alg, corner_key, co_solved

AUFS = [('AUF U', ['U']), ('AUF U2', ['U2']), ("AUF U'", ["U'"])]
OCLL = AUFS + [('小鱼 Sune', SUNE), ('反小鱼 Antisune', ANTISUNE)]
CPLL = AUFS + [('T-perm', TPERM), ('Y-perm', YPERM)]


def cmll_states():
    """648 个顶层角块状态 (两桥角块固定)."""
    out = []
    for perm in permutations(range(4)):
        for tw in product(range(3), repeat=4):
            if sum(tw) % 3:
                continue
            cs = [(perm[i], tw[i]) for i in range(4)] + [(i, 0) for i in range(4, 8)]
            out.append(cs)
    return out


def state_of(cs):
    return (tuple(cs), R.SOLVED[1])


def analyse_cmll():
    """直接按 App 的做法: 从还原态用公式集 BFS 生成 CMLL 状态图."""
    gens = OCLL + CPLL
    start = R.SOLVED
    k0 = corner_key(start)
    idx = {k0: 0}
    arr = [tuple(start[0])]
    adj = []
    q = deque([0])
    while q:
        i = q.popleft()
        row = {}
        for name, alg in gens:
            ns = apply_alg(state_of(list(arr[i])), alg)
            k = corner_key(ns)
            if k not in idx:
                idx[k] = len(arr)
                arr.append(tuple(ns[0]))
                adj.append(None)
                q.append(idx[k])
            row[name] = idx[k]
        if len(adj) <= i:
            adj.append(row)
        else:
            adj[i] = row
    n = len(arr)
    print(f'CMLL 状态图: {n} 个状态 (目标 648)')

    def multisource(sources, gens_sub):
        dist = {s: 0 for s in sources}
        q = deque(sources)
        while q:
            i = q.popleft()
            for name, _ in gens_sub:
                j = adj[i][name]
                if j not in dist:
                    dist[j] = dist[i] + 1
                    q.append(j)
        return dist

    co_done = [i for i, cs in enumerate(arr) if all(o == 0 for _, o in cs)]
    solved = idx[corner_key(R.SOLVED)]
    d1 = multisource(co_done, OCLL)
    print(f'阶段1 (OCLL: 小鱼/反小鱼 + AUF) 可覆盖 {len(d1)}/{n} 种角块情况, '
          f'最长 {max(d1.values())} 条公式')
    d2 = multisource([solved], CPLL)
    reach2 = [i for i in co_done if i in d2]
    print(f'阶段2 (CPLL: T-perm/Y-perm + AUF) 可覆盖 {len(reach2)}/{len(co_done)} 个已朝向状态, '
          f'最长 {max(d2[i] for i in reach2)} 条公式')
    d2b = multisource([solved], AUFS + [('T-perm', TPERM)])
    reach2b = [i for i in co_done if i in d2b]
    print(f'  仅用 T-perm + AUF 覆盖 {len(reach2b)}/{len(co_done)}')
    return d1, d2, arr, idx, adj, co_done


def lse_staging():
    lse_moves = ['M', 'M2', "M'", 'U', 'U2', "U'"]
    states = [R.SOLVED]
    idx = {R.key(R.SOLVED): 0}
    adj = []
    q = deque([0])
    while q:
        i = q.popleft()
        st = states[i]
        for mv in lse_moves:
            ns = R.apply(st, mv)
            k = R.key(ns)
            if k not in idx:
                idx[k] = len(states)
                states.append(ns)
                adj.append(None)
                q.append(idx[k])
        if len(states) > 200000:
            break
    # 邻接
    adj = []
    for st in states:
        row = []
        for mv in lse_moves:
            row.append(idx[R.key(R.apply(st, mv))])
        adj.append(row)
    print(f'\nLSE 图: {len(states)} 个状态 (角块可能被转动)')

    def is_lse_edge(c):
        return c in (0, 1, 2, 3, 5, 7)

    def eo_ok(i):
        es = states[i][1]
        return all(es[j][1] == 0 for j in (0, 1, 2, 3, 5, 7))

    def ulur_ok(i):
        es = states[i][1]
        return es[0][0] == 0 and es[2][0] == 2

    def multisource(goal_fn):
        dist = [-1] * len(states)
        q = deque()
        for i in range(len(states)):
            if goal_fn(i):
                dist[i] = 0
                q.append(i)
        while q:
            i = q.popleft()
            for j in adj[i]:
                if dist[j] < 0:
                    dist[j] = dist[i] + 1
                    q.append(j)
        return dist

    d4a = multisource(eo_ok)
    d4b = multisource(lambda i: eo_ok(i) and ulur_ok(i))
    d4c = multisource(lambda i: i == 0)
    print(f'  4a 目标集可达性: 未覆盖 {sum(1 for x in d4a if x < 0)} 个状态')
    print(f'  4b 目标集可达性: 未覆盖 {sum(1 for x in d4b if x < 0)} 个状态')

    corner_solved_nodes = [i for i, st in enumerate(states)
                           if all(c == j and o == 0 for j, (c, o) in enumerate(st[0]))]
    tot = Counter()
    worst = 0
    for i in corner_solved_nodes:
        # 贪心下降: 依次走 4a -> 4b -> 4c
        cur, n1 = i, 0
        while d4a[cur] > 0:
            cur = min(adj[cur], key=lambda j: d4a[j])
            n1 += 1
        n2 = 0
        while d4b[cur] > 0:
            cur = min(adj[cur], key=lambda j: d4b[j])
            n2 += 1
        n3 = d4c[cur]
        tot['4a'] += n1
        tot['4b'] += n2
        tot['4c'] += n3
        worst = max(worst, n1 + n2 + n3)
    n = len(corner_solved_nodes)
    print(f'  角块已还原的状态 {n} 个, 分段平均: 4a {tot["4a"]/n:.2f} + '
          f'4b {tot["4b"]/n:.2f} + 4c {tot["4c"]/n:.2f} = '
          f'{(tot["4a"]+tot["4b"]+tot["4c"])/n:.2f} 步 (最长 {worst} 步)')
    print('  对比: 不分段的最优解平均 10.85 步')


if __name__ == '__main__':
    print('=== CMLL 两阶段结构 ===')
    analyse_cmll()
    lse_staging()
