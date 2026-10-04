#!/usr/bin/env python3
"""独立校验 roux_feasibility_probe 的魔方模型是否几何正确."""
import random
import roux_feasibility_probe as R


def det3(a, b, c):
    return (a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]))


def is_side(name):
    return not any(v[1] != 0 for v in R.normals(name))


def std_flip(pos, cub, idx):
    """Kociemba 约定: U/D 面色的棱是否在 U/D 面 / 侧棱的 F,B 面色是否在 F/B 面."""
    return idx ^ (1 if (is_side(R.EDGE_POS[pos]) != ('U' not in R.EDGE_POS[cub]
                                                    and 'D' not in R.EDGE_POS[cub])) else 0)


def std_twist(pos, idx):
    """角块扭角, 按该位置 (y,x,z) 标架的左右手性校正."""
    ns = R.normals(R.CORNER_POS[pos])
    hand = det3(*ns)
    return idx if hand > 0 else (3 - idx) % 3


def invariants(s):
    cs, es = s
    return (sum(std_twist(i, o) for i, (c, o) in enumerate(cs)) % 3,
            sum(std_flip(i, c, o) for i, (c, o) in enumerate(es)) % 2)


def par(where):
    n = len(where)
    p = list(where)
    s = 0
    for i in range(n):
        while p[i] != i:
            j = p[i]
            p[i], p[j] = p[j], p[i]
            s ^= 1
    return s


def parity_ok(s):
    cs, es = s
    cw = [0] * 8
    for pos, (c, o) in enumerate(cs):
        cw[c] = pos
    ew = [0] * 12
    for pos, (c, o) in enumerate(es):
        ew[c] = pos
    return par(cw) == par(ew)


def main():
    FACE = [m for b in 'UDLRFB' for m in (b, b + '2', b + "'")]
    random.seed(11)
    bad = {'twist': 0, 'flip': 0, 'parity': 0}
    for _ in range(500):
        s = R.SOLVED
        for _ in range(30):
            s = R.apply(s, random.choice(FACE))
            tw, fl = invariants(s)
            if tw:
                bad['twist'] += 1
                break
            if fl:
                bad['flip'] += 1
                break
            if not parity_ok(s):
                bad['parity'] += 1
                break
    print('面转随机游走 500 条 (每条 30 步) 不变量违反次数:', bad)

    # 单步转动的扭角/翻棱和
    for mv in ['U', 'D', 'R', 'L', 'F', 'B', 'M', "M'"]:
        s = R.apply(R.SOLVED, mv)
        print(f'  {mv:3s} 扭角和%3 = {invariants(s)[0]}, 翻棱和%2 = {invariants(s)[1]}')

    # superflip: 全部 12 棱翻转, 其余全还原
    SUPER = "U R2 F B R B2 R U2 L B2 R U D R2 F R L B2 U2 F2".split()
    s = R.SOLVED
    for mv in SUPER:
        s = R.apply(s, mv)
    cs, es = s
    corners_done = all(c == i and o == 0 for i, (c, o) in enumerate(cs))
    all_flipped = all(std_flip(i, c, o) == 1 for i, (c, o) in enumerate(es))
    print(f'superflip 公式: 角块全还原 = {corners_done}, 12 棱全翻转 = {all_flipped}')

    # T 型 PLL: 交换两角两棱, 朝向不变
    TPERM = "R U R' U' R' F R2 U' R' U' R U R' F'".split()
    s = R.SOLVED
    for mv in TPERM:
        s = R.apply(s, mv)
    tw, fl = invariants(s)
    moved_c = sum(1 for i, (c, o) in enumerate(s[0]) if c != i or o != 0)
    moved_e = sum(1 for i, (c, o) in enumerate(s[1]) if c != i or o != 0)
    print(f'T-perm: 动到的角块数 = {moved_c}, 棱块数 = {moved_e}, '
          f'扭角和 = {tw}, 翻棱和 = {fl}')

    # 已知阶数: (R U) 63 阶, (R U') 105 阶, (R U R' U') 6 阶
    def order(seq, cap=2000):
        s = R.SOLVED
        for k in range(1, cap + 1):
            for mv in seq:
                s = R.apply(s, mv)
            if s == R.SOLVED:
                return k
        return None
    print('阶数: (R U) =', order(['R', 'U']),
          " (R U') =", order(['R', "U'"]),
          ' (sexy) =', order(['R', 'U', "R'", "U'"]))


if __name__ == '__main__':
    main()
