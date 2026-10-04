#!/usr/bin/env python3
"""CMLL 公式集验证: 目标是用尽可能少的约定公式覆盖全部 648 种角块情况.

候选公式: 小鱼(Sune) / 反小鱼(Antisune) / T-perm / Y-perm  (+ AUF)
要求: 每条公式都保持左右两桥不动 (角块朝向可以在过程中变化, 但 CP 公式必须保持朝向).
"""
from collections import Counter, deque

import roux_feasibility_probe as R

SUNE = "R U R' U R U2 R'".split()
ANTISUNE = "R U2 R' U' R U' R'".split()
TPERM = "R U R' U' R' F R2 U' R' U' R U R' F'".split()
YPERM = "F R U' R' U' R U R' F' R U R' U' R' F R F'".split()
APERM = "R' F R' B2 R F' R' B2 R2".split()

BLOCK_SLOTS = [('c', 4), ('c', 5), ('c', 6), ('c', 7),
               ('e', 4), ('e', 6), ('e', 8), ('e', 9), ('e', 10), ('e', 11)]


def apply_alg(state, alg):
    for mv in alg:
        state = R.apply(state, mv)
    return state


def blocks_intact(state):
    cs, es = state
    for k, i in BLOCK_SLOTS:
        if (cs[i] if k == 'c' else es[i]) != (i, 0):
            return False
    return True


def corners_solved(state):
    return all(c == i and o == 0 for i, (c, o) in enumerate(state[0]))


def corner_key(state):
    return tuple((c, o) for c, o in state[0])


def co_solved(state):
    return all(o == 0 for _, o in state[0])


def describe(state, label):
    s = apply_alg(R.SOLVED, label if isinstance(label, list) else label)
    cs, es = s
    moved_c = [(R.CORNER_POS[i], R.CORNER_POS[c]) for i, (c, o) in enumerate(cs) if (c, o) != (i, 0)]
    moved_e = [(R.EDGE_POS[i], R.EDGE_POS[c]) for i, (c, o) in enumerate(es) if (c, o) != (i, 0)]
    return moved_c, moved_e


def main():
    formulas = [('AUF U', ['U'], 'auf'), ('AUF U2', ['U2'], 'auf'), ("AUF U'", ["U'"], 'auf'),
                ('小鱼 Sune', SUNE, 'co'), ('反小鱼 Antisune', ANTISUNE, 'co'),
                ('T-perm', TPERM, 'cp'), ('Y-perm', YPERM, 'cp'), ('A-perm', APERM, 'cp')]
    print('=== 候选公式的性质 ===')
    for name, alg, kind in formulas:
        s = apply_alg(R.SOLVED, alg)
        mc, me = describe(R.SOLVED, alg)
        print(f'{name:14s} 两桥保持={blocks_intact(s)!s:5s} 角朝向保持={co_solved(s)!s:5s} '
              f'动到角={len(mc)} 动到棱={len(me)}')

    gens = [g for g in formulas if g[2] != 'cp'] + [g for g in formulas if g[2] == 'cp']
    print('\n=== 覆盖度 (可达角块状态数, 目标 648) ===')
    for subset_name, subset in (
            ('小鱼+反小鱼+AUF', [g for g in formulas if g[2] in ('auf', 'co')]),
            ('+T-perm', [g for g in formulas if g[2] in ('auf', 'co') or g[0] == 'T-perm']),
            ('+T-perm+Y-perm', [g for g in formulas if g[0] != 'A-perm']),
            ('全部候选', formulas)):
        seen = {corner_key(R.SOLVED): []}
        q = deque([R.SOLVED])
        while q:
            st = q.popleft()
            for name, alg, _ in subset:
                ns = apply_alg(st, alg)
                k = corner_key(ns)
                if k not in seen:
                    seen[k] = seen[corner_key(st)] + [name]
                    q.append(ns)
        lens = Counter(len(v) for v in seen.values())
        print(f'{subset_name:18s} 覆盖 {len(seen):3d}/648  公式数分布 {dict(sorted(lens.items()))}')

    # 用最小可用集合, 统计"每个 case 需要几条公式"与最长公式数
    best = [g for g in formulas if g[0] != 'A-perm']
    seen = {corner_key(R.SOLVED): []}
    q = deque([R.SOLVED])
    while q:
        st = q.popleft()
        for name, alg, _ in best:
            ns = apply_alg(st, alg)
            k = corner_key(ns)
            if k not in seen:
                seen[k] = seen[corner_key(st)] + [name]
                q.append(ns)
    if len(seen) == 648:
        print('\n最小覆盖集合 = 小鱼 + 反小鱼 + T-perm + Y-perm + AUF (共 4 条公式)')
        print('每个 CMLL 情况需要的公式条数分布 =',
              dict(sorted(Counter(len(v) for v in seen.values()).items())))
        worst = max(seen.values(), key=len)
        print('最坏情况示例 =', ' -> '.join(worst))


if __name__ == '__main__':
    main()
