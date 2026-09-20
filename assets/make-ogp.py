#!/usr/bin/env python3
"""
OGP 画像を生成する。Discord などに URL を貼ったときのカードに出る絵。

アプリアイコン（make-icon.py）と同じ LED ドットマトリクスの意匠で、
掲示板が文字を流している様子を模す。

    python3 assets/make-ogp.py board > public/ogp.svg
    python3 assets/make-ogp.py admin > public/admin/ogp.svg
"""

import sys

W, H = 1200, 630

ON = "#ffb020"    # 点灯（琥珀。実際のLED掲示板の色）
OFF = "#241f14"   # 消灯
BG = "#0b0b0c"
SUB = "#8a8a8a"

# 5x7 ドットフォント。掲示板らしさを出すため、文字はドットで描く。
GLYPHS = {
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "M": ["1000001", "1100011", "1010101", "1001001", "1000001", "1000001", "1000001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "I": ["111", "010", "010", "010", "010", "010", "111"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    " ": ["0", "0", "0", "0", "0", "0", "0"],
}


def pattern(text: str) -> list[str]:
    """文字列をドットの行に変換する。文字の間は1列あける。"""
    rows = 7
    return ["0".join(GLYPHS[ch][r] for ch in text) for r in range(rows)]


def dots(text: str, x0: float, y0: float, pitch: float, fill: float) -> str:
    """点灯・消灯をすべて描く。消灯も描くことで LED パネルらしくなる。"""
    pat = pattern(text)
    out = []
    for r, row in enumerate(pat):
        for c, lit in enumerate(row):
            cx = x0 + c * pitch + pitch / 2
            cy = y0 + r * pitch + pitch / 2
            color = ON if lit == "1" else OFF
            out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{fill / 2:.1f}" fill="{color}"/>')
    return "".join(out)


def render(kind: str) -> str:
    text = "SIGNBOARD"
    pitch = 26
    fill = pitch * 0.8
    cols = len(pattern(text)[0])
    grid_w = cols * pitch
    x0 = (W - grid_w) / 2
    y0 = 190

    label = {
        "board": "リビングの電光掲示板",
        "admin": "掲示板の管理",
    }[kind]

    note = {
        "board": "シェアハウスのお知らせが流れています",
        "admin": "お知らせの投稿と表示の設定",
    }[kind]

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <rect width="{W}" height="{H}" fill="{BG}"/>

  <!-- 上下の縁。LED パネルの筐体に見立てる -->
  <rect x="0" y="0" width="{W}" height="6" fill="{ON}" opacity="0.5"/>
  <rect x="0" y="{H - 6}" width="{W}" height="6" fill="{ON}" opacity="0.5"/>

  {dots(text, x0, y0, pitch, fill)}

  <text x="{W / 2}" y="130" fill="#f2f0ec" font-size="52" font-weight="700"
        text-anchor="middle"
        font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif">{label}</text>

  <text x="{W / 2}" y="470" fill="{SUB}" font-size="28"
        text-anchor="middle"
        font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif">{note}</text>

  <text x="{W / 2}" y="545" fill="{ON}" font-size="24" letter-spacing="2"
        text-anchor="middle"
        font-family="ui-monospace, SFMono-Regular, Menlo, monospace">signboard.emaker.dev</text>
</svg>"""


if __name__ == "__main__":
    kind = sys.argv[1] if len(sys.argv) > 1 else "board"
    if kind not in ("board", "admin"):
        raise SystemExit("使い方: make-ogp.py [board|admin]")
    print(render(kind))
