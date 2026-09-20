#!/usr/bin/env python3
"""
Discord アプリのアイコンを生成する。

LED ドットマトリクス風に文字を描く。色・文字・ドットの詰まり具合を変えたくなったら
下の定数をいじって実行する。出力は SVG（そのままでもアップロード可）。
PNG が要る場合は SVG をブラウザで開いて 1024x1024 でスクリーンショットする。

    python3 assets/make-icon.py > assets/app-icon.svg
"""

ON = "#ffb020"    # 点灯（琥珀。実際のLED掲示板の色）
OFF = "#241f14"   # 消灯
BG = "#0d0d0d"
MARGIN = 190      # 外周の余白 px（小さいほどドットが大きく詰まる）
FILL_RATIO = 0.78 # ドット直径 / ピッチ。上げるとベタっと明るく、下げると粒が立つ

# 5x7 ドットフォント。1列空けて2文字並べる。
GLYPHS = {
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "M": ["1000001", "1100011", "1010101", "1001001", "1000001", "1000001", "1000001"],
}
TEXT = ["E", "M"]


def pattern() -> list[str]:
    rows = len(next(iter(GLYPHS.values())))
    return ["0".join(GLYPHS[ch][r] for ch in TEXT) for r in range(rows)]


def render(pat: list[str]) -> str:
    rows, cols = len(pat), len(pat[0])
    pitch = (1024 - MARGIN * 2) / max(cols, rows)
    size = pitch * FILL_RATIO
    sx = (1024 - pitch * cols) / 2
    sy = (1024 - pitch * rows) / 2

    dots = []
    for r in range(rows):
        for c in range(cols):
            cx = sx + c * pitch + pitch / 2
            cy = sy + r * pitch + pitch / 2
            color = ON if pat[r][c] == "1" else OFF
            dots.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{size / 2:.1f}" fill="{color}"/>')

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
        f'<rect width="1024" height="1024" rx="232" fill="{BG}"/>'
        f'{"".join(dots)}</svg>'
    )


if __name__ == "__main__":
    print(render(pattern()))
