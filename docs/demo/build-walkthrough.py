"""Render a captioned quick-start tutorial using generated demo data.

Requires Pillow and FFmpeg. No accounts, external messages, or network access.
"""
from __future__ import annotations

import argparse
import importlib.util
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("showcase", HERE / "build-showcase.py")
assert SPEC and SPEC.loader
film = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(film)
FPS, INTRO, STRETCH, OUTRO = 20, 10.0, 1.3, 12.0
WORKFLOW_END = INTRO + film.DURATION * STRETCH
DURATION = WORKFLOW_END + OUTRO
SIZE = (1280, 720)


def card(title: str, lines: list[str]) -> Image.Image:
    canvas = film.BASE.copy()
    film.text(canvas, 140, 165, "GHOSTFILL / QUICK START", 34, film.BLUE, "semibold")
    film.text(canvas, 140, 265, title, 90, film.WHITE, "semibold")
    for index, line in enumerate(lines):
        film.text(canvas, 146, 440 + index * 95, line, 43, film.WHITE)
    film.rule(canvas, (146, 870, 1770, 870), film.BLUE, 4)
    film.text(canvas, 146, 909, "Illustrated tutorial • demo data • captions included", 30, film.SOFT)
    return canvas.convert("RGB")


INSTALL = card("Install in Chrome", [
    "1. Download the built ZIP from GitHub Releases and extract it.",
    "2. Open chrome://extensions and enable Developer mode.",
    "3. Click Load unpacked; select the folder with manifest.json.",
    "4. Pin GhostFill and refresh your signup page.",
])
UPDATES = card("Enable automatic updates once", [
    "In your installed Windows folder, double-click:",
    "Enable Automatic Updates.cmd",
    "Windows checks stable releases every six hours.",
    "GhostFill reloads when idle. Refresh signup tabs afterward.",
])


def workflow_frame(time: float) -> Image.Image:
    canvas = film.frame(time)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 962, film.WIDTH, film.HEIGHT), fill=film.BG)
    if time < 2.7:
        caption = "Open GhostFill from the pinned toolbar icon."
    elif time < 5.55:
        caption = "Generate an address from an available provider."
    elif time < 9.45:
        caption = "Fill the email, password, and matching identity fields."
    elif time < 14:
        caption = "Matched code fills first; a verification link is the alternative."
    elif time < 17.1:
        caption = "Optional Gmail aliases use an inbox you own and connect."
    else:
        caption = "Review uncertain messages in GhostFill's inbox."
    film.centered(canvas, 984, caption, 38, film.WHITE)
    draw.rounded_rectangle((1350, 15, 1880, 68), radius=15, fill=film.BG)
    film.text(canvas, 1380, 25, "ILLUSTRATED / DEMO DATA", 27, film.SOFT, "semibold")
    return canvas


def frame(time: float) -> Image.Image:
    if time < INTRO:
        canvas = INSTALL.copy()
    elif time < WORKFLOW_END:
        canvas = workflow_frame((time - INTRO) / STRETCH)
    else:
        canvas = UPDATES.copy()
    return canvas.resize(SIZE, Image.Resampling.LANCZOS)


def timestamp(time: float) -> str:
    seconds, milliseconds = divmod(round(time * 1000), 1000)
    minutes, seconds = divmod(seconds, 60)
    return f"00:{minutes:02}:{seconds:02}.{milliseconds:03}"


def render() -> None:
    output = HERE / "ghostfill-quickstart.mp4"
    command = ["ffmpeg", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
               "-video_size", "1280x720", "-framerate", str(FPS), "-i", "-",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert process.stdin
    try:
        for index in range(round(FPS * DURATION)):
            process.stdin.write(frame(index / FPS).tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("FFmpeg failed to build the tutorial.")
    INSTALL.resize(SIZE, Image.Resampling.LANCZOS).save(HERE / "ghostfill-quickstart-poster.png")
    segments = [
        (0, INTRO, "Download the built ZIP, extract it, load the folder in Chrome, and pin GhostFill."),
        (INTRO, INTRO + 5.55 * STRETCH, "Open GhostFill and generate an address from an available provider."),
        (INTRO + 5.55 * STRETCH, INTRO + 9.45 * STRETCH, "Fill the matching signup fields, then request verification on the site."),
        (INTRO + 9.45 * STRETCH, INTRO + 14 * STRETCH, "Fresh matching codes fill first; approved verification links can open in a new tab. Review uncertain messages manually."),
        (INTRO + 14 * STRETCH, WORKFLOW_END, "Optional Gmail aliases require connecting an inbox you own."),
        (WORKFLOW_END, DURATION, "On Windows, run Enable Automatic Updates.cmd once in the installed folder. Checks run every six hours; GhostFill reloads when idle. Refresh signup tabs afterward."),
    ]
    captions = "WEBVTT\n\n" + "\n\n".join(
        f"{timestamp(start)} --> {timestamp(end)}\n{text}" for start, end, text in segments
    ) + "\n"
    (HERE / "ghostfill-quickstart.vtt").write_text(captions, encoding="utf-8")
    print(f"Created {output.name}: {DURATION:.2f} seconds, 1280×720, captioned demo data.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    if args.preview:
        sheet = Image.new("RGB", (1280, 720))
        for index, moment in enumerate((0, INTRO + 6 * STRETCH, INTRO + 12 * STRETCH, WORKFLOW_END + 1)):
            sheet.paste(frame(moment).resize((640, 360)), ((index % 2) * 640, (index // 2) * 360))
        sheet.save(HERE / "ghostfill-quickstart-review.png")
    else:
        render()
