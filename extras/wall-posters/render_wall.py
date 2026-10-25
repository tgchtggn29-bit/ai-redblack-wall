"""产品红黑榜 投票墙 —— 5 种风格 × 正面 / 侧面 两个视角
数据为对照片的目测估算（贴纸数量与红/绿比例），仅作示意。
"""
import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FD = "/usr/share/fonts/opentype/noto/"
def F(size, w="Black", serif=False):
    return ImageFont.truetype(FD + ("NotoSerifCJK-" if serif else "NotoSansCJK-") + w + ".ttc", size, index=2)

# ---------- 从照片识别出的布局与估算数据 ----------
# (名称, 估算贴纸数, 差评(红✗)占比)
COLS = [
    [("ChatGPT", 360, .14), ("豆包", 260, .38), ("豆包工作", 75, .78), ("即梦AI", 48, .68), ("（看不清）", 6, .5)],
    [("Claude", 420, .55), ("DeepSeek", 340, .10), ("千问办公", 52, .62), ("可灵AI", 10, .40), ("蚂蚁阿福", 42, .40)],
    [("Gemini", 72, .32), ("千问", 60, .25), ("WorkBuddy", 125, .40), ("小云雀", 16, .35), ("夸克", 26, .30)],
    [("Muse", 16, .10), ("元宝", 72, .48), ("百度搭子DuMate", 52, .55), ("剪映", 46, .55), ("微信小微", 40, .72)],
    [("Today AI", 6, .20), ("Kimi", 82, .20), ("商汤小浣熊", 46, .30), ("LibTV", 24, .30), ("小美", 3, .30)],
    [("Qoder", 26, .20), ("MiniMax", 40, .30), ("Manus", 36, .35), ("Vidu", 3, .30), ("点点AI", 14, .30)],
    [("ZCode", 30, .20), ("阶跃AI", 30, .35), ("Genspark", 10, .30), ("TapNow", 12, .30), ("安克AI录音豆", 6, .30)],
    [("Tripo", 22, .25), ("Elys", 18, .30), ("Cherry Studio", 16, .30), ("OiiOii", 8, .30), ("Plaud", 6, .30)],
]
COL_W = [3.3, 2.9, 1.95, 1.65, 1.4, 1.2, 1.1, 1.0]

W, H = 4400, 2100
HEADER = 360
PAD = 40

def layout():
    tiles = []
    gw = W - PAD * 2
    unit = (gw - 14 * (len(COL_W) - 1)) / sum(COL_W)
    rows_h = (H - HEADER - PAD) / 5
    x = PAD
    rnd = random.Random(7)
    for ci, col in enumerate(COLS):
        cw = COL_W[ci] * unit
        for ri, (name, n, red) in enumerate(col):
            y = HEADER + ri * rows_h
            box = (x, y, x + cw, y + rows_h - 14)
            # 贴纸位置（所有风格共用同一组随机点，保证可比）
            lh = rows_h * (.30 if ci < 2 else .26)
            ax0, ay0, ax1, ay1 = box[0] + 18, box[1] + lh, box[2] - 18, box[3] - 14
            area = (ax1 - ax0) * (ay1 - ay0)
            r = max(7, min(19, math.sqrt(area / max(n, 1)) * .40))
            pts = []
            for k in range(n):
                px = rnd.uniform(ax0 + r, ax1 - r)
                py = rnd.uniform(ay0 + r, ay1 - r)
                pts.append((px, py, rnd.random() < red))
            tiles.append(dict(name=name, n=n, red=red, box=box, r=r, pts=pts, big=ci < 2, ci=ci))
        x += cw + 14
    return tiles

TILES = layout()

def fit_font(d, text, maxw, size, w="Black", serif=False):
    while size > 14:
        f = F(size, w, serif)
        if d.textlength(text, font=f) <= maxw:
            return f
        size -= 2
    return F(14, w, serif)

def badge_letter(name):
    for ch in name:
        if ch.strip() and ch not in "（）":
            return ch.upper()
    return "?"

def check(d, cx, cy, r, color, width):
    d.line([(cx - r * .45, cy), (cx - r * .1, cy + r * .38), (cx + r * .5, cy - r * .4)], fill=color, width=width)

def cross(d, cx, cy, r, color, width):
    k = r * .38
    d.line([(cx - k, cy - k), (cx + k, cy + k)], fill=color, width=width)
    d.line([(cx - k, cy + k), (cx + k, cy - k)], fill=color, width=width)

# ---------- 风格 ----------
def style_sticker():
    """1 手绘贴纸：还原原版"""
    im = Image.new("RGB", (W, H), "#f3f2ec")
    d = ImageDraw.Draw(im)
    # 天空/云彩装饰
    d.ellipse((380, -260, 1400, 330), fill="#c9d6e3")
    d.ellipse((1050, -180, 1900, 300), fill="#c9d6e3")
    # 绿色描边外框
    d.rounded_rectangle((18, 150, W - 18, H - 10), 40, outline="#7a9a3c", width=14)
    d.rounded_rectangle((W * .42, 20, W - 18, 300), 50, fill="#f3f2ec", outline="#7a9a3c", width=14)
    t = ["产", "品", "红", "黑", "榜"]
    x = W * .45
    for i, ch in enumerate(t):
        col = "#d42a2a" if ch == "红" else "#111"
        d.text((x + 6, 48), ch, font=F(220), fill="#cfcfcf")
        d.text((x, 40), ch, font=F(220), fill=col)
        x += 250
    # 皇冠
    cx = W * .45 + 20
    d.polygon([(cx, 60), (cx + 30, 0), (cx + 60, 40), (cx + 95, -10), (cx + 120, 50), (cx + 120, 85), (cx, 95)], fill="#f5cf1f", outline="#111")
    d.text((W - 820, 230), "√ 绿 = 好评    × 红 = 差评", font=F(40, "Bold"), fill="#555")
    for t_ in TILES:
        x0, y0, x1, y1 = t_["box"]
        d.rounded_rectangle((x0, y0, x1, y1), 18, fill="#fbfbf8", outline="#d9d9d2", width=4)
        hh = (y1 - y0) * (.30 if t_["big"] else .26)
        d.rounded_rectangle((x0 + 6, y0 + 6, x1 - 6, y0 + hh - 4), 14, fill="#e4e4de")
        bs = int(hh * .62)
        d.rounded_rectangle((x0 + 18, y0 + 14, x0 + 18 + bs, y0 + 14 + bs), 12, fill="#2c3e50")
        d.text((x0 + 18 + bs / 2, y0 + 14 + bs / 2), badge_letter(t_["name"]), font=F(int(bs * .55)), fill="white", anchor="mm")
        f = fit_font(d, t_["name"], x1 - x0 - bs - 50, int(hh * (.55 if t_["big"] else .42)))
        d.text((x0 + 32 + bs, y0 + 14 + bs / 2), t_["name"], font=f, fill="#222", anchor="lm")
        r = t_["r"]
        for px, py, red in t_["pts"]:
            c = "#c9372c" if red else "#6b9a3a"
            d.ellipse((px - r + 2, py - r + 3, px + r + 2, py + r + 3), fill="#00000030" if False else "#c8c8c0")
            d.ellipse((px - r, py - r, px + r, py + r), fill=c, outline="#2a2a2a", width=2)
            d.ellipse((px - r * .45, py - r * .45, px + r * .45, py + r * .45), fill="white")
            (cross if red else check)(d, px, py, r * .9, c, max(2, int(r * .22)))
            # 小耳朵（原图贴纸是小动物造型）
            d.ellipse((px - r * .9, py - r * 1.15, px - r * .4, py - r * .65), fill=c, outline="#2a2a2a", width=1)
            d.ellipse((px + r * .4, py - r * 1.15, px + r * .9, py - r * .65), fill=c, outline="#2a2a2a", width=1)
    return im, "#ffffff", "#9a9a90"

def style_neon():
    """2 赛博霓虹"""
    im = Image.new("RGB", (W, H), "#07070f")
    glow = Image.new("RGB", (W, H), "black")
    d, g = ImageDraw.Draw(im), ImageDraw.Draw(glow)
    for yy in range(0, H, 60):
        d.line([(0, yy), (W, yy)], fill="#11112a", width=1)
    for xx in range(0, W, 60):
        d.line([(xx, 0), (xx, H)], fill="#11112a", width=1)
    title = "产品红黑榜"
    f = F(230)
    tx = W / 2 - d.textlength(title, font=f) / 2
    for i, ch in enumerate(title):
        c = "#ff2e63" if ch == "红" else "#08f7fe"
        g.text((tx, 40), ch, font=f, fill=c)
        d.text((tx, 40), ch, font=f, fill="#ffffff" if ch != "红" else "#ffd0dc")
        tx += d.textlength(ch, font=f)
    lf = F(40, "Bold")
    d.ellipse((W - 420, 285, W - 390, 315), fill="#39ff88"); d.text((W - 375, 300), "好评", font=lf, fill="#9aa", anchor="lm")
    d.ellipse((W - 220, 285, W - 190, 315), fill="#ff2e63"); d.text((W - 175, 300), "差评", font=lf, fill="#9aa", anchor="lm")
    for t_ in TILES:
        x0, y0, x1, y1 = t_["box"]
        g.rounded_rectangle((x0, y0, x1, y1), 14, outline="#7b2ff7", width=8)
        d.rounded_rectangle((x0, y0, x1, y1), 14, fill="#0d0d1e", outline="#b48cff", width=2)
        hh = (y1 - y0) * (.30 if t_["big"] else .26)
        f = fit_font(d, t_["name"], x1 - x0 - 40, int(hh * (.58 if t_["big"] else .45)), "Bold")
        g.text((x0 + 22, y0 + hh / 2), t_["name"], font=f, fill="#08f7fe", anchor="lm")
        d.text((x0 + 22, y0 + hh / 2), t_["name"], font=f, fill="#e8fdff", anchor="lm")
        r = t_["r"] * .8
        for px, py, red in t_["pts"]:
            c = "#ff2e63" if red else "#39ff88"
            g.ellipse((px - r * 1.6, py - r * 1.6, px + r * 1.6, py + r * 1.6), fill=c)
            d.ellipse((px - r, py - r, px + r, py + r), fill=c)
            d.ellipse((px - r * .4, py - r * .4, px + r * .4, py + r * .4), fill="white")
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    from PIL import ImageChops
    im = ImageChops.add(im, glow)
    return im, "#05050c", "#1a1a33"

def style_minimal():
    """3 极简数据风：每格附好评率条"""
    im = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(im)
    d.text((PAD, 70), "产品红黑榜", font=F(170, "Black"), fill="#111")
    d.text((PAD + 900, 120), "按贴纸数与好评率重绘 · 数据为照片估算", font=F(54, "Regular"), fill="#888")
    d.text((W - PAD, 300), "■ 好评   ■ 差评", font=F(40, "Medium"), fill="#444", anchor="rm")
    d.rectangle((W - 335, 283, W - 305, 313), fill="#2f9e6e"); d.rectangle((W - 165, 283, W - 135, 313), fill="#e0493e")
    for t_ in TILES:
        x0, y0, x1, y1 = t_["box"]
        d.rectangle((x0, y0, x1, y1), fill="#f6f6f4")
        hh = (y1 - y0) * (.30 if t_["big"] else .26)
        good = 1 - t_["red"]
        stat = f"{t_['n']}票 · 好评{good:.0%}"
        sf = F(max(18, int(hh * (.26 if t_["big"] else .2))), "Medium")
        sw = d.textlength(stat, font=sf)
        f = fit_font(d, t_["name"], max(60, x1 - x0 - 50 - (sw if t_["big"] else 0)), int(hh * (.45 if t_["big"] else .34)), "Bold")
        d.text((x0 + 18, y0 + hh * .42), t_["name"], font=f, fill="#111", anchor="lm")
        if t_["big"]:
            d.text((x1 - 18, y0 + hh * .42), stat, font=sf, fill="#777", anchor="rm")
        else:
            d.text((x0 + 18, y0 + hh * .78), stat, font=fit_font(d, stat, x1 - x0 - 36, int(hh * .2), "Medium"), fill="#777", anchor="lm")
        bw = x1 - x0 - 36
        d.rectangle((x0 + 18, y0 + hh + 4, x0 + 18 + bw * good, y0 + hh + 12), fill="#2f9e6e")
        d.rectangle((x0 + 18 + bw * good, y0 + hh + 4, x0 + 18 + bw, y0 + hh + 12), fill="#e0493e")
        r = t_["r"] * .55
        for px, py, red in t_["pts"]:
            d.ellipse((px - r, py - r, px + r, py + r), fill="#e0493e" if red else "#2f9e6e")
    return im, "#ffffff", "#e8e8e4"

def style_pixel():
    """4 像素街机：低分辨率绘制再放大"""
    s = 6
    im = Image.new("RGB", (W // s, H // s), "#1b1e3a")
    d = ImageDraw.Draw(im)
    title = "产品红黑榜"
    f = F(42)
    tw = d.textlength(title, font=f)
    x = (W // s - tw) / 2
    for ch in title:
        d.text((x + 2, 10), ch, font=f, fill="#000")
        d.text((x, 8), ch, font=f, fill="#ff4d4d" if ch == "红" else "#ffd23f")
        x += d.textlength(ch, font=f)
    d.text((W // s - 8, 50), "GOOD   BAD", font=F(9, "Bold"), fill="#9fe", anchor="rm")
    for t_ in TILES:
        x0, y0, x1, y1 = [v / s for v in t_["box"]]
        d.rectangle((x0, y0, x1, y1), fill="#2b2f5c", outline="#7ef9ff", width=1)
        hh = (y1 - y0) * (.30 if t_["big"] else .26)
        d.rectangle((x0 + 2, y0 + 2, x1 - 2, y0 + hh - 2), fill="#3d4385")
        f = fit_font(d, t_["name"], x1 - x0 - 6, int(hh * .55), "Bold")
        d.text((x0 + 4, y0 + hh / 2), t_["name"], font=f, fill="#fff", anchor="lm")
        r = max(1, int(t_["r"] / s * .8))
        for px, py, red in t_["pts"]:
            px, py = int(px / s), int(py / s)
            d.rectangle((px - r, py - r, px + r, py + r), fill="#ff4d4d" if red else "#5cff7a")
            d.point((px - r + 1 if r > 1 else px, py - r + 1 if r > 1 else py), fill="#ffffff")
    im = im.resize((W, H), Image.NEAREST)
    return im, "#0d0f20", "#3a3f7a"

def style_ink():
    """5 中式红榜黑榜：宣纸水墨，红=上红榜(好评) 黑=上黑榜(差评)"""
    rnd = random.Random(3)
    im = Image.new("RGB", (W, H), "#efe6d2")
    d = ImageDraw.Draw(im)
    for _ in range(9000):  # 宣纸纤维
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        d.line([(x, y), (x + rnd.randint(-20, 20), y + rnd.randint(-3, 3))], fill="#e2d6bc", width=1)
    d.rectangle((14, 14, W - 14, H - 14), outline="#7a1f1f", width=8)
    d.rectangle((30, 30, W - 30, H - 30), outline="#7a1f1f", width=2)
    f = F(200, "Black", serif=True)
    title = "產品紅黑榜"
    x = W / 2 - d.textlength(title, font=f) / 2
    for ch in title:
        d.text((x, 50), ch, font=f, fill="#b3181d" if ch == "紅" else "#1a1a1a")
        x += d.textlength(ch, font=f)
    # 印章
    d.rectangle((W - 330, 70, W - 120, 280), fill="#b3181d")
    d.text((W - 225, 175), "观猹\n民选", font=F(70, "Black", True), fill="#efe6d2", anchor="mm", align="center", spacing=4)
    d.text((PAD + 20, 300), "朱点＝上红榜（好评）    墨点＝上黑榜（差评）", font=F(42, "Medium", True), fill="#5a4a3a", anchor="lm")
    for t_ in TILES:
        x0, y0, x1, y1 = t_["box"]
        d.rectangle((x0, y0, x1, y1), outline="#8b6b4a", width=3)
        hh = (y1 - y0) * (.30 if t_["big"] else .26)
        f = fit_font(d, t_["name"], x1 - x0 - 40, int(hh * (.55 if t_["big"] else .42)), "Bold", True)
        d.text((x0 + 20, y0 + hh / 2), t_["name"], font=f, fill="#1a1a1a", anchor="lm")
        d.line([(x0 + 14, y0 + hh), (x1 - 14, y0 + hh)], fill="#8b6b4a", width=2)
        r = t_["r"] * .75
        for px, py, red in t_["pts"]:
            jr = r * rnd.uniform(.8, 1.15)
            c = "#1a1a1a" if red else "#c0262b"  # 注意：此风格中“红”代表好评
            d.ellipse((px - jr * 1.15, py - jr * 1.1, px + jr * 1.1, py + jr * 1.15), fill="#d9ccb2")
            d.ellipse((px - jr, py - jr, px + jr, py + jr), fill=c)
    return im, "#d8cdb5", "#6e5a44"

STYLES = [
    ("1_手绘贴纸", style_sticker),
    ("2_赛博霓虹", style_neon),
    ("3_极简数据", style_minimal),
    ("4_像素街机", style_pixel),
    ("5_水墨红黑榜", style_ink),
]

# ---------- 侧面视角：透视变换 ----------
def persp_coeffs(dst, src):
    import numpy as np
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def side_view(front, wall_col, floor_col):
    CW, CH = 2600, 1500
    canvas = Image.new("RGB", (CW, CH), wall_col)
    d = ImageDraw.Draw(canvas)
    # 地面
    d.polygon([(0, 1380), (CW, 1010), (CW, CH), (0, CH)], fill=floor_col)
    quad = [(60, 40), (CW - 60, 470), (CW - 60, 960), (60, 1340)]  # 左近右远
    big = front.resize((W, H))
    coeffs = persp_coeffs(quad, [(0, 0), (W, 0), (W, H), (0, H)])
    warped = big.transform((CW, CH), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    # 远处变暗，模拟光照
    shade = Image.linear_gradient("L").rotate(90, expand=True).resize((CW, CH))
    shade = shade.point(lambda v: int(v * .35))
    warped = Image.composite(Image.new("RGB", (CW, CH), "black"), warped, shade)
    # 墙体厚度阴影
    sh = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(sh).polygon([(q[0] + 18, q[1] + 22) for q in quad], fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(20))
    canvas = Image.composite(Image.new("RGB", (CW, CH), "black"), canvas, sh)
    canvas.paste(warped, (0, 0), mask)
    return canvas

def compose(name, front, side):
    fw = 2600
    fh = int(H * fw / W)
    sheet = Image.new("RGB", (fw, fh + side.height + 220), "#fafafa")
    d = ImageDraw.Draw(sheet)
    d.text((40, 30), f"{name.split('_',1)[1]} · 正面", font=F(52, "Bold"), fill="#222")
    sheet.paste(front.resize((fw, fh), Image.LANCZOS), (0, 110))
    d.text((40, fh + 130), f"{name.split('_',1)[1]} · 侧面", font=F(52, "Bold"), fill="#222")
    sheet.paste(side, (0, fh + 210))
    return sheet

if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    for name, fn in STYLES:
        front, wall_col, floor_col = fn()
        side = side_view(front, wall_col, floor_col)
        front.save(f"{out}/{name}_正面.png")
        side.save(f"{out}/{name}_侧面.png")
        compose(name, front, side).save(f"{out}/{name}.png", optimize=True)
        print("done", name)
