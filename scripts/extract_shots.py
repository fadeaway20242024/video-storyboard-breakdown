#!/usr/bin/env python3
import argparse
import json
import re
import shutil
import subprocess
import sys
from fractions import Fraction
from pathlib import Path


PTS_PATTERN = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")


def fail(message: str) -> None:
    raise SystemExit(message)


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail(f"缺少必需命令：{name}")
    return path


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture,
    )


def parse_fraction(value: str | None) -> float:
    if not value or value == "0/0":
        return 0.0
    return float(Fraction(value))


def probe_video(ffprobe: str, source: Path) -> dict:
    result = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,channels,sample_rate",
            "-of",
            "json",
            str(source),
        ],
        capture=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    if not video_stream:
        fail("文件中没有可读取的视频流。")
    duration = float(payload.get("format", {}).get("duration") or 0)
    if duration <= 0:
        fail("无法取得有效视频时长。")
    fps = parse_fraction(video_stream.get("avg_frame_rate")) or parse_fraction(video_stream.get("r_frame_rate"))
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), None)
    return {
        "duration_seconds": round(duration, 6),
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "fps": round(fps, 6),
        "video_codec": video_stream.get("codec_name") or "unknown",
        "has_audio": audio_stream is not None,
        "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        "audio_channels": audio_stream.get("channels") if audio_stream else None,
        "audio_sample_rate": int(audio_stream.get("sample_rate") or 0) if audio_stream else None,
    }


def detect_cuts(ffmpeg: str, source: Path, threshold: float) -> list[float]:
    scene_filter = f"select=gt(scene\\,{threshold:.4f}),showinfo"
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            str(source),
            "-an",
            "-vf",
            scene_filter,
            "-f",
            "null",
            "-",
        ],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        fail(f"场景检测失败：\n{result.stderr[-2000:]}")
    return sorted({round(float(match), 6) for match in PTS_PATTERN.findall(result.stderr)})


def load_manual_cuts(path: Path) -> list[float]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = [line.strip() for line in text.splitlines() if line.strip()]
    if isinstance(payload, dict):
        payload = (
            payload.get("cuts")
            or payload.get("cuts_seconds")
            or payload.get("boundaries")
            or payload.get("boundaries_seconds")
            or []
        )
    if not isinstance(payload, list):
        fail("cuts 文件必须是秒数数组、包含 cuts/boundaries 的对象，或逐行秒数文本。")
    try:
        return [float(value) for value in payload]
    except (TypeError, ValueError) as exc:
        fail(f"cuts 文件包含非数字内容：{exc}")


def normalize_cuts(cuts: list[float], duration: float, min_shot: float) -> list[float]:
    cleaned = sorted({round(value, 6) for value in cuts if 0 < value < duration})
    accepted = []
    previous = 0.0
    for cut in cleaned:
        if cut - previous < min_shot:
            continue
        if duration - cut < min_shot:
            continue
        accepted.append(cut)
        previous = cut
    if accepted and duration - accepted[-1] < min_shot:
        accepted.pop()
    return accepted


def grab_frame(ffmpeg: str, source: Path, timestamp: float, output: Path, width: int) -> None:
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{timestamp:.6f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2",
            "-q:v",
            "2",
            "-y",
            str(output),
        ]
    )


def font_for_sheet(size: int):
    from PIL import ImageFont

    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def labeled_panel(path: Path, label: str, width: int = 560):
    from PIL import Image, ImageDraw

    image = Image.open(path).convert("RGB")
    height = round(image.height * width / image.width)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    label_height = 36
    panel = Image.new("RGB", (width, height + label_height), "#FFFFFF")
    panel.paste(image, (0, label_height))
    draw = ImageDraw.Draw(panel)
    draw.text((10, 8), label, fill="#292321", font=font_for_sheet(16))
    return panel


def build_contact(paths: list[Path], labels: list[str], output: Path, columns: int) -> None:
    from PIL import Image

    if not paths:
        return
    panels = [labeled_panel(path, label) for path, label in zip(paths, labels)]
    rows = (len(panels) + columns - 1) // columns
    panel_width, panel_height = panels[0].size
    sheet = Image.new("RGB", (columns * panel_width, rows * panel_height), "#E9E1DA")
    for index, panel in enumerate(panels):
        x = (index % columns) * panel_width
        y = (index // columns) * panel_height
        sheet.paste(panel, (x, y))
    sheet.save(output, quality=92)


def create_contact_sheets(shots: list[dict], root: Path, contact_dir: Path) -> list[str]:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return []

    outputs: list[str] = []
    page_size = 24
    for page_index, page_start in enumerate(range(0, len(shots), page_size), 1):
        page = shots[page_start:page_start + page_size]
        paths = [root / shot["frames"]["key"] for shot in page]
        labels = [
            f"{shot['shot_id']}  {shot['start_seconds']:.2f}-{shot['end_seconds']:.2f}s"
            for shot in page
        ]
        name = "关键帧总览.jpg" if len(shots) <= page_size else f"关键帧总览_{page_index:02d}.jpg"
        output = contact_dir / name
        build_contact(paths, labels, output, columns=4)
        outputs.append(str(output.relative_to(root)))

    batch_size = 6
    for batch_start in range(0, len(shots), batch_size):
        batch = shots[batch_start:batch_start + batch_size]
        paths: list[Path] = []
        labels: list[str] = []
        for shot in batch:
            for label in ("start", "key", "end"):
                paths.append(root / shot["frames"][label])
                labels.append(
                    f"{shot['shot_id']} {label}  {shot['start_seconds']:.2f}-{shot['end_seconds']:.2f}s"
                )
        first = batch_start + 1
        last = batch_start + len(batch)
        output = contact_dir / f"三帧对照_{first:02d}-{last:02d}.jpg"
        build_contact(paths, labels, output, columns=3)
        outputs.append(str(output.relative_to(root)))
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description="检测视频剪辑点并提取逐镜关键帧与三帧对照。")
    parser.add_argument("video", type=Path, help="源视频路径")
    parser.add_argument("--output-dir", required=True, type=Path, help="输出目录")
    parser.add_argument("--threshold", type=float, default=0.18, help="场景检测阈值，默认 0.18")
    parser.add_argument("--min-shot", type=float, default=0.35, help="最短镜头秒数，默认 0.35")
    parser.add_argument("--frame-width", type=int, default=960, help="截图宽度，默认 960")
    parser.add_argument("--cuts-file", type=Path, help="人工确认的切点秒数 JSON 或逐行文本")
    parser.add_argument("--overwrite", action="store_true", help="允许覆盖同目录已有分析文件")
    args = parser.parse_args()

    source = args.video.expanduser().resolve()
    root = args.output_dir.expanduser().resolve()
    if not source.is_file():
        fail(f"视频不存在：{source}")
    if not 0 < args.threshold < 1:
        fail("threshold 必须在 0 和 1 之间。")
    if args.min_shot <= 0:
        fail("min-shot 必须大于 0。")
    if args.frame_width < 320:
        fail("frame-width 不应小于 320。")

    analysis_path = root / "analysis.json"
    if analysis_path.exists() and not args.overwrite:
        fail(f"输出目录已有 analysis.json；请改用新目录或添加 --overwrite：{root}")

    ffmpeg = require_binary("ffmpeg")
    ffprobe = require_binary("ffprobe")
    metadata = probe_video(ffprobe, source)
    duration = metadata["duration_seconds"]

    if args.cuts_file:
        cuts_file = args.cuts_file.expanduser().resolve()
        if not cuts_file.is_file():
            fail(f"cuts 文件不存在：{cuts_file}")
        raw_cuts = load_manual_cuts(cuts_file)
        detection_mode = "manual"
    else:
        raw_cuts = detect_cuts(ffmpeg, source, args.threshold)
        detection_mode = "scene-detect"

    cuts = normalize_cuts(raw_cuts, duration, args.min_shot)
    boundaries = [0.0, *cuts, duration]

    key_dir = root / "keyframes"
    analysis_dir = root / "analysis_frames"
    contact_dir = root / "contact_sheets"
    for directory in (key_dir, analysis_dir, contact_dir):
        directory.mkdir(parents=True, exist_ok=True)

    shots = []
    for index, (start, end) in enumerate(zip(boundaries[:-1], boundaries[1:]), 1):
        shot_id = f"S{index:02d}"
        shot_duration = end - start
        inset = min(0.18, shot_duration * 0.12)
        times = {
            "start": start + inset,
            "key": start + shot_duration / 2,
            "end": max(start + inset, end - inset),
        }
        frame_paths = {
            "start": analysis_dir / f"{shot_id}_start.jpg",
            "key": key_dir / f"{shot_id}_key.jpg",
            "end": analysis_dir / f"{shot_id}_end.jpg",
        }
        for label, timestamp in times.items():
            grab_frame(ffmpeg, source, timestamp, frame_paths[label], args.frame_width)
        shots.append(
            {
                "shot_id": shot_id,
                "start_seconds": round(start, 6),
                "end_seconds": round(end, 6),
                "duration_seconds": round(shot_duration, 6),
                "sample_times": {key: round(value, 6) for key, value in times.items()},
                "frames": {
                    key: str(path.relative_to(root))
                    for key, path in frame_paths.items()
                },
            }
        )

    contact_sheets = create_contact_sheets(shots, root, contact_dir)
    payload = {
        "source_path": str(source),
        "output_dir": str(root),
        "metadata": metadata,
        "detection": {
            "mode": detection_mode,
            "threshold": None if args.cuts_file else args.threshold,
            "min_shot_seconds": args.min_shot,
            "raw_candidate_count": len(raw_cuts),
            "accepted_cut_count": len(cuts),
        },
        "boundaries_seconds": [round(value, 6) for value in boundaries],
        "shots": shots,
        "contact_sheets": contact_sheets,
    }
    root.mkdir(parents=True, exist_ok=True)
    analysis_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "analysis": str(analysis_path),
                "shot_count": len(shots),
                "duration_seconds": duration,
                "contact_sheets": contact_sheets,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"命令执行失败：{exc}", file=sys.stderr)
        raise SystemExit(exc.returncode)
