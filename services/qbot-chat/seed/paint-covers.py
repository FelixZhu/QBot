"""Rasterize the two feed covers with the system CJK font.

The font file stays on the machine that runs this script. It is not copied
into the bundle. Re-running can change pixels; the committed PNGs and the
manifest hashes are the published bytes.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent / "bundles"
FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
INK = (28, 27, 25, 255)
CREAM = (243, 239, 231, 255)
ORANGE = (255, 106, 43, 255)
MUTED = (74, 70, 62, 255)


def face(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


def rule(draw: ImageDraw.ImageDraw, y: int, width: int) -> None:
    draw.rectangle((36, y, width - 36, y + 6), fill=INK)
    draw.rectangle((36, y + 12, width - 36, y + 14), fill=INK)


def paint_info(path: Path) -> None:
    width, height = 780, 1040
    image = Image.new("RGBA", (width, height), CREAM)
    draw = ImageDraw.Draw(image)
    draw.text((36, 36), "QBOT BRIEF", font=face(22), fill=INK)
    draw.text((width - 120, 36), "手写", font=face(22), fill=INK)
    rule(draw, 78, width)
    chip(draw, 36, 116, "手写", filled=True)
    chip(draw, 130, 116, "说明", filled=False)
    draw.text((36, 168), "3", font=face(200), fill=INK)
    draw.text((36, 400), "三个入口：今日、对话、知识库", font=face(36), fill=INK)
    draw.multiline_text((36, 470), "这一张是项目说明，不是新闻。\n数字只描述这个应用。", font=face(26), fill=MUTED, spacing=8)
    y = 620
    rows = [("01", "今日", "关注与推荐，按时间从新到旧"), ("02", "对话", "只有 Qbot，会话都在里面"), ("03", "知识库", "仍是原来的库")]
    draw.rectangle((36, y, width - 36, y + 4), fill=INK)
    y += 16
    for number, tag, text in rows:
        draw.text((36, y), number, font=face(22), fill=INK)
        chip(draw, 100, y - 4, tag, filled=True)
        draw.text((210, y), text, font=face(24), fill=INK)
        y += 72
    draw.text((36, height - 72), "Qbot 手写", font=face(20), fill=MUTED)
    image.save(path, "PNG")


def paint_english(path: Path) -> None:
    width, height = 780, 1040
    image = Image.new("RGBA", (width, height), ORANGE)
    draw = ImageDraw.Draw(image)
    draw.text((36, 36), "DAILY SPOKEN ENGLISH", font=face(20), fill=INK)
    draw.text((width - 110, 36), "手写", font=face(22), fill=INK)
    rule(draw, 78, width)
    chip(draw, 36, 116, "手写", filled=True)
    chip(draw, 130, 116, "短语", filled=False)
    draw.text((36, 200), "get this over", font=face(64), fill=INK)
    draw.text((36, 280), "the line", font=face(64), fill=INK)
    draw.text((36, 390), "把快完成的事推过终点线", font=face(36), fill=INK)
    draw.text((36, 450), "不是启动，是收尾。", font=face(26), fill=INK)
    draw.rounded_rectangle((36, 540, width - 36, 760), radius=28, fill=CREAM)
    draw.text((60, 568), "EXAMPLE", font=face(18), fill=INK)
    draw.multiline_text((60, 610), "Let's get that over the line today,\nso marketing can schedule spend tonight.", font=face(28), fill=INK, spacing=8)
    draw.text((36, 800), "没有音频，也没有跟读打分。", font=face(26), fill=INK)
    draw.text((36, height - 72), "Qbot 手写", font=face(20), fill=INK)
    image.save(path, "PNG")


def chip(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, filled: bool) -> None:
    box = (x, y, x + 84, y + 36)
    if filled:
        draw.rounded_rectangle(box, radius=16, fill=INK)
        draw.text((x + 16, y + 4), text, font=face(20), fill=CREAM)
    else:
        draw.rounded_rectangle(box, radius=16, outline=INK, width=3)
        draw.text((x + 16, y + 4), text, font=face(20), fill=INK)


if __name__ == "__main__":
    paint_info(ROOT / "info" / "cover.png")
    paint_english(ROOT / "english" / "cover.png")
