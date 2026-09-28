"""Render GhostFill's illustrated product film with Pillow and FFmpeg."""

from __future__ import annotations

import argparse
import math
import subprocess
import wave
from array import array
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT, FPS, DURATION = 1920, 1080, 30, 19.2
BG = (9, 14, 22)
WHITE = (247, 249, 252)
INK = (29, 29, 31)
SOFT = (164, 178, 196)
BLUE = (10, 132, 255)
BLUE_DARK = (0, 102, 204)
MINT = (48, 209, 88)
AMBER = (255, 159, 10)
FONT_FILES = {
    "light": "segoeuil.ttf",
    "regular": "segoeui.ttf",
    "semibold": "seguisb.ttf",
    "mono": "bahnschrift.ttf",
}


@lru_cache(maxsize=96)
def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / FONT_FILES[weight]), size)


def ease(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return 1 - (1 - value) ** 3


def progress(t: float, start: float, duration: float) -> float:
    return ease((t - start) / duration)


def text(image: Image.Image, x: int, y: int, value: str, size: int,
         color=WHITE, weight="regular", alpha=255):
    alpha = max(0, min(255, int(alpha)))
    if not value or not alpha:
        return
    face = font(size, weight)
    if alpha == 255:
        ImageDraw.Draw(image).text((x, y), value, font=face, fill=(*color, alpha))
        return
    left, top, right, bottom = ImageDraw.Draw(image).textbbox((0, 0), value, font=face)
    layer = Image.new("RGBA", (right-left+1, bottom-top+1))
    ImageDraw.Draw(layer).text((-left, -top), value, font=face, fill=(*color, alpha))
    image.alpha_composite(layer, (x+left, y+top))


def centered(image: Image.Image, y: int, value: str, size: int,
             color=WHITE, weight="regular", alpha=255):
    bounds = ImageDraw.Draw(image).textbbox((0, 0), value, font=font(size, weight))
    text(image, (WIDTH - (bounds[2]-bounds[0]))//2, y, value, size,
         color, weight, alpha)


def box(image: Image.Image, bounds, fill, radius=20, outline=None, width=2, alpha=255):
    alpha = max(0, min(255, int(alpha)))
    if not alpha:
        return
    x1, y1, x2, y2 = bounds
    layer = image if alpha == 255 else Image.new("RGBA", (x2-x1+1, y2-y1+1))
    local = bounds if alpha == 255 else (0, 0, x2-x1, y2-y1)
    ImageDraw.Draw(layer).rounded_rectangle(
        local, radius=radius, fill=(*fill, alpha),
        outline=(*outline, alpha) if outline else None, width=width)
    if layer is not image:
        image.alpha_composite(layer, (x1, y1))


def rule(image: Image.Image, points, color, width=3, alpha=255):
    alpha = max(0, min(255, int(alpha)))
    if not alpha:
        return
    if alpha == 255:
        ImageDraw.Draw(image).line(points, fill=(*color, alpha), width=width)
        return
    x1, x2 = min(points[::2])-width, max(points[::2])+width
    y1, y2 = min(points[1::2])-width, max(points[1::2])+width
    layer = Image.new("RGBA", (x2-x1+1, y2-y1+1))
    shifted = [v-(x1 if i % 2 == 0 else y1) for i, v in enumerate(points)]
    ImageDraw.Draw(layer).line(shifted, fill=(*color, alpha), width=width)
    image.alpha_composite(layer, (x1, y1))


def dot(image: Image.Image, x: int, y: int, radius: int, color, alpha=255):
    alpha = max(0, min(255, int(alpha)))
    if not alpha:
        return
    if alpha == 255:
        ImageDraw.Draw(image).ellipse((x-radius, y-radius, x+radius, y+radius),
                                      fill=(*color, alpha))
        return
    layer = Image.new("RGBA", (radius*2+1, radius*2+1))
    ImageDraw.Draw(layer).ellipse((0, 0, radius*2, radius*2), fill=(*color, alpha))
    image.alpha_composite(layer, (x-radius, y-radius))


@lru_cache(maxsize=12)
def shadow(width: int, height: int, radius: int) -> Image.Image:
    layer = Image.new("RGBA", (width+100, height+100))
    ImageDraw.Draw(layer).rounded_rectangle(
        (50, 35, width+50, height+35), radius=radius, fill=(0, 0, 0, 105))
    return layer.filter(ImageFilter.GaussianBlur(32))


def panel(image: Image.Image, bounds, fill, radius=27, edge=(225, 230, 237)):
    x1, y1, x2, y2 = bounds
    image.alpha_composite(shadow(x2-x1, y2-y1, radius), (x1-50, y1-35))
    box(image, bounds, fill, radius, edge, 2)
    rule(image, (x1+radius, y1+2, x2-radius, y1+2), WHITE, 2, 100)


def background() -> Image.Image:
    base = Image.new("RGBA", (WIDTH, HEIGHT), (*BG, 255))
    light = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(light)
    draw.ellipse((790, -540, 2300, 970), fill=(15, 103, 205, 44))
    draw.ellipse((-760, 650, 680, 1900), fill=(24, 72, 138, 30))
    return Image.alpha_composite(base, light.filter(ImageFilter.GaussianBlur(170)))


BASE = background()


def chrome(image: Image.Image, t: float):
    dot(image, 125, 91, 8, BLUE)
    text(image, 150, 64, "GhostFill", 42, WHITE, "semibold")
    text(image, 1533, 80, "PRODUCT PREVIEW", 26, SOFT, "mono")
    rule(image, (125, 1005, 1795, 1005), (45, 60, 80), 3)
    rule(image, (125, 1005, 125+round(1670*t/DURATION), 1005), BLUE, 4)


def reveal(image: Image.Image, t: float, start: float, x: int, y: int,
           value: str, size: int, color=WHITE, weight="regular", duration=.55):
    amount = progress(t, start, duration)
    text(image, x, y+round(28*(1-amount)), value, size, color, weight, 255*amount)


def eyebrow(image: Image.Image, label: str):
    text(image, 154, 187, label, 29, BLUE, "mono")


def popup(image: Image.Image, x: int, y: int, address: str,
          mode="temporary", inbox=False):
    width, height = 590, 658
    panel(image, (x, y, x+width, y+height), (248, 249, 251), 30)
    text(image, x+31, y+17, "GhostFill", 39, INK, "semibold")
    dot(image, x+width-57, y+43, 5, (142, 153, 167))
    dot(image, x+width-39, y+43, 5, (142, 153, 167))
    rule(image, (x+1, y+79, x+width-1, y+79), (224, 229, 235), 2)

    box(image, (x+28, y+100, x+width-28, y+162), (236, 239, 243), 31)
    selected = (x+33, y+105, x+292, y+157) if mode == "temporary" else (
        x+298, y+105, x+width-33, y+157)
    box(image, selected, WHITE, 26, (219, 226, 234), 1)
    text(image, x+98, y+113, "Temporary", 28,
         INK if mode == "temporary" else (111, 121, 136), "semibold")
    text(image, x+372, y+113, "Gmail", 28,
         INK if mode == "gmail" else (111, 121, 136), "semibold")

    box(image, (x+28, y+184, x+width-28, y+368), WHITE, 19,
        (222, 228, 235), 2)
    box(image, (x+49, y+206, x+91, y+248), (231, 243, 255), 11)
    text(image, x+59, y+207, "@", 29, BLUE_DARK, "semibold")
    text(image, x+108, y+199, "Email" if mode == "temporary" else "Gmail alias",
         25, (100, 110, 123), "semibold")
    text(image, x+108, y+239, address, 29,
         INK if "@" in address else (108, 120, 136), "mono")
    box(image, (x+500, y+226, x+545, y+271), (242, 245, 248), 12)
    box(image, (x+513, y+238, x+529, y+254), WHITE, 3, (99, 117, 140), 2)
    box(image, (x+520, y+232, x+536, y+248), WHITE, 3, (99, 117, 140), 2)
    rule(image, (x+51, y+284, x+width-51, y+284), (224, 229, 235), 2)
    box(image, (x+49, y+304, x+91, y+346), (231, 248, 235), 11)
    text(image, x+61, y+305, "•", 30, (36, 138, 61), "semibold")
    text(image, x+108, y+297, "Password", 25, (100, 110, 123), "semibold")
    text(image, x+108, y+329, "••••••••••••", 28, INK, "mono")

    box(image, (x+28, y+388, x+width-28, y+630), WHITE, 19,
        (222, 228, 235), 2)
    text(image, x+53, y+401, "Inbox", 30, INK, "semibold")
    text(image, x+446, y+411, "1 new" if inbox else "Ready", 23,
         BLUE_DARK if inbox else (102, 114, 129), "semibold")
    rule(image, (x+53, y+459, x+width-53, y+459), (224, 229, 235), 2)
    dot(image, x+74, y+516, 21, (232, 242, 253))
    text(image, x+65, y+489, "@", 26, BLUE_DARK, "semibold")
    if inbox:
        text(image, x+116, y+476, "Account verification", 26, INK, "semibold")
        text(image, x+116, y+517, "Your one-time code is ready", 25,
             (96, 108, 121))
        box(image, (x+116, y+567, x+312, y+612), (232, 243, 255), 12)
        text(image, x+139, y+566, "482913", 31, BLUE_DARK, "mono")
        text(image, x+350, y+571, "Open link", 22, BLUE_DARK, "semibold")
    else:
        text(image, x+116, y+485, "Waiting for verification", 26,
             INK, "semibold")
        text(image, x+116, y+528, "Codes and links appear here", 24,
             (96, 108, 121))


def browser_shell(image: Image.Image, x: int, y: int, width: int, height: int,
                  extra_tab=False):
    panel(image, (x, y, x+width, y+height), (250, 251, 253), 25)
    box(image, (x+2, y+2, x+width-2, y+78), (232, 236, 241), 24)
    box(image, (x+2, y+45, x+width-2, y+80), (232, 236, 241), 0)
    for i, color in enumerate(((255, 95, 86), (255, 190, 68), (74, 206, 99))):
        dot(image, x+39+i*29, y+40, 8, color)
    box(image, (x+155, y+20, x+545, y+64), WHITE, 13)
    text(image, x+184, y+20, "signup.example", 28, (106, 119, 135))
    if extra_tab:
        box(image, (x+555, y+20, x+850, y+64), (219, 235, 252), 13)
        text(image, x+572, y+23, "Activation link", 24, BLUE_DARK, "semibold")
    rule(image, (x+2, y+80, x+width-2, y+80), (211, 218, 226), 2)


def signup_browser(image: Image.Image, x: int, y: int, t: float):
    width, height = 990, 730
    browser_shell(image, x, y, width, height)
    text(image, x+89, y+113, "Create your account", 55, INK, "semibold")
    text(image, x+91, y+187, "A few details to get started", 30,
         (108, 120, 134))
    fields = (("Username", "demo.user", 6.16),
              ("Email address", "demo@temporary.example", 6.91),
              ("Password", "••••••••••••", 7.67))
    for i, (label, value, start) in enumerate(fields):
        top = y+254+i*123
        fill = progress(t, start, .63)
        text(image, x+91, top-6, label, 26, (78, 90, 105), "semibold")
        box(image, (x+87, top+34, x+width-88, top+102),
            (243, 246, 249), 13, BLUE if 0 < fill < 1 else (207, 216, 226), 3)
        text(image, x+112, top+37, value[:round(len(value)*fill)], 36, INK,
             "mono" if label != "Username" else "regular")
        if fill >= 1:
            rule(image, (x+width-151, top+76, x+width-137, top+89,
                         x+width-112, top+55), (36, 138, 61), 5)
    active = progress(t, 8.24, .36)
    box(image, (x+width-307, y+651, x+width-87, y+701),
        BLUE_DARK if active > .75 else (177, 188, 202), 15)
    text(image, x+width-253, y+653, "Continue", 27, WHITE, "semibold")


def verification_browser(image: Image.Image, x: int, y: int, t: float):
    width, height = 990, 730
    browser_shell(image, x, y, width, height, extra_tab=t >= 13.48)
    text(image, x+88, y+135, "Verify your email", 55, INK, "semibold")
    text(image, x+91, y+210, "Enter the code sent to your address", 30,
         (108, 120, 134))
    for i, digit in enumerate("482913"):
        left = x+104+i*125
        fill = progress(t, 12.02+i*.13, .19)
        box(image, (left, y+340, left+108, y+457),
            (243, 246, 249), 15,
            BLUE if fill > .35 else (205, 215, 225), 3)
        text(image, left+29, y+346, digit if fill > 0 else "", 72,
             INK, "mono", 255*fill)
    ready = progress(t, 12.84, .35)
    box(image, (x+width-338, y+555, x+width-96, y+622),
        BLUE_DARK if ready > .8 else (180, 191, 204), 16)
    text(image, x+width-281, y+560, "Verify", 35, WHITE, "semibold")
    if t >= 13.28:
        text(image, x+106, y+661, "Activation link opens in a new tab",
             27, BLUE_DARK, "semibold")


def opening(image: Image.Image, t: float):
    eyebrow(image, "A CLEANER SIGNUP FLOW")
    reveal(image, t, .12, 155, 300, "Signup,", 112, WHITE, "semibold", .7)
    reveal(image, t, .28, 155, 422, "simplified.", 112, WHITE, "semibold", .7)
    reveal(image, t, .67, 160, 587, "Email. Password. Verification.", 50,
           SOFT, "light", .75)
    entered = progress(t, 1.10, 1.05)
    address = "demo@temporary.example"[:round(22*entered)] if entered else "Generating…"
    lift = round(48*(1-progress(t, .25, .72)))
    popup(image, 1085, 190+lift, address)
    line = progress(t, 1.48, .75)
    rule(image, (160, 746, 160+round(630*line), 746), BLUE, 5, 220)


def providers(image: Image.Image, t: float):
    eyebrow(image, "01 / DISPOSABLE EMAIL")
    reveal(image, t, 2.65, 155, 289, "Provider down?", 90,
           WHITE, "semibold")
    reveal(image, t, 2.93, 158, 393, "Keep moving.", 88, SOFT, "light")
    first = progress(t, 3.40, .48)
    second = progress(t, 4.29, .5)
    rule(image, (159, 572, 874, 572), (58, 75, 96), 2)
    rule(image, (159, 700, 874, 700), (58, 75, 96), 2)
    text(image, 166, 517, "Provider 01", 36, WHITE, "semibold")
    text(image, 574, 519, "Unavailable" if first > .76 else "Checking…",
         32, AMBER if first > .76 else SOFT)
    dot(image, 847, 545, 9, AMBER if first > .76 else SOFT)
    text(image, 166, 645, "Provider 02", 36, WHITE, "semibold")
    text(image, 650, 646, "Ready" if second > .76 else "Trying…",
         32, MINT if second > .76 else SOFT)
    dot(image, 847, 672, 9, MINT if second > .76 else SOFT)
    text(image, 163, 771, "Multiple providers. One uninterrupted flow.",
         35, SOFT, "light")
    lift = round(45*(1-progress(t, 2.62, .6)))
    popup(image, 1085, 190+lift,
          "demo@temporary.example" if t >= 4.8 else "Finding an address…")


def smart_fill(image: Image.Image, t: float):
    eyebrow(image, "02 / SMART FILL")
    reveal(image, t, 5.55, 155, 300, "Three fields.", 86,
           WHITE, "semibold")
    reveal(image, t, 5.85, 155, 405, "One action.", 86, WHITE, "semibold")
    reveal(image, t, 6.20, 159, 545, "Username, email, password.", 40,
           SOFT, "light")
    box(image, (163, 736, 522, 820), BLUE_DARK, 22)
    text(image, 218, 747, "Smart Fill  →", 40, WHITE, "semibold")
    lift = round(45*(1-progress(t, 5.45, .58)))
    signup_browser(image, 800, 176+lift, t)


def verification(image: Image.Image, t: float):
    eyebrow(image, "03 / VERIFICATION")
    reveal(image, t, 9.65, 154, 292, "Code in.", 87,
           WHITE, "semibold")
    reveal(image, t, 9.95, 154, 393, "Link open.", 87,
           WHITE, "semibold")
    panel(image, (155, 530, 745, 859), (248, 249, 251), 25)
    text(image, 192, 551, "GhostFill inbox", 35, INK, "semibold")
    rule(image, (193, 620, 705, 620), (219, 226, 234), 2)
    text(image, 193, 637, "Account verification", 29, INK, "semibold")
    text(image, 193, 687, "Your one-time code", 27, (101, 113, 128))
    amount = progress(t, 10.81, .45)
    text(image, 194, 722, "482913", 68, BLUE_DARK, "mono", 255*amount)
    text(image, 196, 804, "Activation link", 29, BLUE_DARK, "semibold",
         255*progress(t, 12.88, .48))
    handoff = progress(t, 11.75, .4)
    if 0 < handoff < 1:
        rule(image, (753, 723, 792, 723), BLUE, 4, 175)
        dot(image, 754+round(38*handoff), 723, 8, BLUE)
    lift = round(42*(1-progress(t, 9.48, .6)))
    verification_browser(image, 800, 176+lift, t)


def gmail_alias(image: Image.Image, t: float):
    eyebrow(image, "04 / GMAIL ALIAS")
    reveal(image, t, 14.10, 154, 287, "Temporary email", 83,
           WHITE, "semibold")
    reveal(image, t, 14.32, 154, 384, "blocked?", 83,
           WHITE, "semibold")
    reveal(image, t, 14.75, 158, 543, "Use an alias you own.", 56,
           SOFT, "light")
    rule(image, (158, 710, 853, 710), (59, 78, 101), 2)
    text(image, 161, 735, "name+site@gmail.com", 49, WHITE, "mono",
         255*progress(t, 15.16, .58))
    text(image, 161, 812, "Messages stay in your Gmail inbox.", 32,
         SOFT, "light", 255*progress(t, 15.55, .5))
    lift = round(45*(1-progress(t, 14.02, .65)))
    address = "name+site@gmail.com" if t >= 15.38 else "Preparing alias…"
    popup(image, 1085, 190+lift, address, mode="gmail")


def end_card(image: Image.Image, t: float):
    rise = round(42*(1-progress(t, 17.00, .68)))
    centered(image, 313+rise, "GhostFill", 177, WHITE,
             "semibold", 255*progress(t, 17.00, .68))
    centered(image, 542, "Sign up, minus the busywork.", 64,
             SOFT, "light", 255*progress(t, 17.45, .57))
    amount = progress(t, 17.81, .52)
    rule(image, (613, 676, 613+round(694*amount), 676), BLUE, 5, 215)
    centered(image, 760, "github.com/Xshya19/ghostfill-extension", 42,
             (169, 209, 249), "regular", 255*progress(t, 18.03, .44))


SCENES = ((0.0, 2.70, opening), (2.70, 5.55, providers),
          (5.55, 9.45, smart_fill), (9.45, 14.00, verification),
          (14.00, 17.10, gmail_alias), (17.10, DURATION, end_card))


def frame(t: float) -> Image.Image:
    canvas = BASE.copy()
    chrome(canvas, t)
    for start, end, scene in SCENES:
        if start <= t < end:
            scene(canvas, t)
            break
    return canvas.convert("RGB")


def soundtrack(path: Path):
    sample_rate = 48_000
    samples = array("f", [0.0]) * round(sample_rate*DURATION)
    cues = ((1.90, 523.25, .075), (4.72, 587.33, .07),
            (6.67, 440.00, .045), (7.42, 493.88, .045),
            (8.19, 587.33, .05), (11.88, 659.25, .06),
            (13.52, 783.99, .075), (15.49, 587.33, .07),
            (17.26, 523.25, .075))
    for start, frequency, volume in cues:
        first = round(start*sample_rate)
        for offset in range(round(.43*sample_rate)):
            elapsed = offset/sample_rate
            envelope = min(1, elapsed/.006) * math.exp(-elapsed*11)
            sound = math.sin(2*math.pi*frequency*elapsed)
            sound += .24*math.sin(4*math.pi*frequency*elapsed)
            samples[first+offset] += volume*envelope*sound
    pcm = array("h", (round(max(-1, min(1, value))*32767) for value in samples))
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        output.writeframes(pcm.tobytes())


def render():
    output = HERE / "ghostfill-showcase.mp4"
    audio = HERE / ".ghostfill-showcase-audio.wav"
    soundtrack(audio)
    command = ["ffmpeg", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
               "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS),
               "-i", "-", "-i", str(audio), "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
               "-shortest", "-movflags", "+faststart",
               str(output)]
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert process.stdin is not None
        try:
            for index in range(round(FPS*DURATION)):
                process.stdin.write(frame(index/FPS).tobytes())
        finally:
            process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("FFmpeg failed to render the product film")
    finally:
        audio.unlink(missing_ok=True)
    frame(18.75).save(HERE / "ghostfill-showcase-poster.png")
    subprocess.run(["ffmpeg", "-y", "-i", str(output), "-vf",
                    "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];"
                    "[s0]palettegen=max_colors=112:stats_mode=diff[p];"
                    "[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
                    "-loop", "0", str(HERE / "ghostfill-showcase.gif")],
                   check=True, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    if args.preview:
        probe = Image.new("RGBA", (150, 150), (255, 255, 255, 255))
        text(probe, 2, 2, "A", 50, (0, 0, 0), alpha=128)
        box(probe, (80, 2, 120, 42), (0, 0, 0), alpha=128)
        rule(probe, (3, 100, 58, 100), (0, 0, 0), 5, 128)
        dot(probe, 120, 100, 12, (0, 0, 0), 128)
        assert probe.getchannel("R").getextrema()[0] >= 125
        times = (2.1, 4.8, 8.7, 12.7, 16.0, 18.75)
        sheet = Image.new("RGB", (WIDTH, HEIGHT))
        for index, moment in enumerate(times):
            still = frame(moment)
            assert still.size == (WIDTH, HEIGHT)
            sheet.paste(still.resize((WIDTH//3, HEIGHT//2), Image.Resampling.LANCZOS),
                        ((index % 3)*WIDTH//3, (index//3)*HEIGHT//2))
        sheet.save(HERE / "ghostfill-showcase-contact-sheet.png")
    else:
        render()
