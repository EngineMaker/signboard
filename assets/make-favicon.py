#!/usr/bin/env python3
"""
favicon を生成する。

アプリアイコン（make-icon.py）と同じ LED ドットの意匠だが、
16x16 でも潰れないように単純化する。

- 小サイズ: 3x3 の点だけ。文字は入れない（縮小すると読めなくなるため）
- 大サイズ: "EM" をドットで描く（アプリアイコンと同じ）

    python3 assets/make-favicon.py small > assets/favicon-small.svg
    python3 assets/make-favicon.py large > assets/favicon-large.svg
"""

import sys

ON = "#ffb020"    # 点灯（琥珀）
OFF = "#2a2318"   # 消灯。小サイズでは背景に近づけて潰れを防ぐ
BG = "#0b0b0c"

GLYPHS = {
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "M": ["1000001", "1100011", "1010101", "1001001", "1000001", "1000001", "1000001"],
}


def small(size: int = 64) -> str:
    """
    16x16 まで縮んでも形が残る版。
    3x3 のドットを均等に置くだけ。「何かのランプが光っている」と分かれば十分。
    """
    pitch = size / 3.4
    r = pitch * 0.30
    start = (size - pitch * 2) / 2

    dots = []
    for row in range(3):
        for col in range(3):
            cx = start + col * pitch
            cy = start + row * pitch
            # 中央の縦一列と中段を点灯させ、十字に見せる
            lit = (row == 1) or (col == 1)
            dots.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{ON if lit else OFF}"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{size * 0.18:.1f}" fill="{BG}"/>'
        f'{"".join(dots)}</svg>'
    )


def large(size: int = 180) -> str:
    """ホーム画面に追加したときなど、大きく出る場面用。"EM" を描く。"""
    rows = 7
    pattern = ["0".join(GLYPHS[ch][r] for ch in ("E", "M")) for r in range(rows)]
    cols = len(pattern[0])

    margin = size * 0.16
    pitch = (size - margin * 2) / max(cols, rows)
    r = pitch * 0.38
    x0 = (size - pitch * cols) / 2
    y0 = (size - pitch * rows) / 2

    dots = []
    for row in range(rows):
        for col in range(cols):
            cx = x0 + col * pitch + pitch / 2
            cy = y0 + row * pitch + pitch / 2
            lit = pattern[row][col] == "1"
            dots.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{ON if lit else "#241f14"}"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{size * 0.18:.1f}" fill="{BG}"/>'
        f'{"".join(dots)}</svg>'
    )


if __name__ == "__main__":
    kind = sys.argv[1] if len(sys.argv) > 1 else "small"
    if kind == "small":
        print(small())
    elif kind == "large":
        print(large())
    else:
        raise SystemExit("使い方: make-favicon.py [small|large]")
