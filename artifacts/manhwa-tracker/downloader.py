"""
Download chapter images and stitch them into a single tall image (14000px width).
Then zip and upload to Google Drive.
"""

import os
import io
import re
import zipfile
import asyncio
import tempfile
from typing import List, Optional
from pathlib import Path

import cloudscraper
from PIL import Image


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://google.com/",
}

TARGET_WIDTH = 14000
STITCH_WIDTH = 14000


def _safe_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def download_image(url: str, referer: str = "") -> Optional[bytes]:
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True}
    )
    headers = {**HEADERS}
    if referer:
        headers["Referer"] = referer
    try:
        resp = scraper.get(url, headers=headers, timeout=30)
        if resp.status_code == 200 and resp.content:
            return resp.content
    except Exception as e:
        print(f"[Downloader] Failed to download {url}: {e}")
    return None


async def download_chapter_images(
    image_urls: List[str], referer: str = ""
) -> List[bytes]:
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, download_image, url, referer)
        for url in image_urls
    ]
    results = await asyncio.gather(*tasks)
    valid = [r for r in results if r]
    print(f"[Downloader] Downloaded {len(valid)}/{len(image_urls)} images")
    return valid


def stitch_images(image_data_list: List[bytes]) -> Optional[bytes]:
    """
    Stitch images vertically into one tall image,
    resized to TARGET_WIDTH wide (preserving aspect ratio).
    """
    if not image_data_list:
        return None

    pil_images = []
    for data in image_data_list:
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            # Scale to target width
            ratio = TARGET_WIDTH / img.width
            new_h = int(img.height * ratio)
            img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)
            pil_images.append(img)
        except Exception as e:
            print(f"[Stitcher] Image open error: {e}")

    if not pil_images:
        return None

    total_height = sum(img.height for img in pil_images)
    stitched = Image.new("RGB", (TARGET_WIDTH, total_height), (255, 255, 255))

    y_offset = 0
    for img in pil_images:
        stitched.paste(img, (0, y_offset))
        y_offset += img.height

    out = io.BytesIO()
    stitched.save(out, format="JPEG", quality=92, optimize=True)
    out.seek(0)
    mb = out.getbuffer().nbytes / (1024 * 1024)
    print(f"[Stitcher] Final image: {TARGET_WIDTH}x{total_height}px — {mb:.1f} MB")
    return out.read()


def create_zip(
    image_data_list: List[bytes],
    manga_title: str,
    chapter: float,
) -> Optional[bytes]:
    """Create a CBZ (ZIP of JPEGs) for the chapter."""
    if not image_data_list:
        return None

    out = io.BytesIO()
    safe_title = _safe_filename(manga_title)
    ch_str = f"{chapter:g}"

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, data in enumerate(image_data_list, start=1):
            zf.writestr(f"{safe_title}_Ch{ch_str}_{i:03d}.jpg", data)

    out.seek(0)
    return out.read()


async def process_chapter(
    image_urls: List[str],
    manga_title: str,
    chapter: float,
    referer: str = "",
    stitch: bool = True,
) -> dict:
    """
    Download + optionally stitch images.
    Returns {"raw": [bytes], "stitched": bytes | None, "zip": bytes}
    """
    raw_images = await download_chapter_images(image_urls, referer)

    stitched = None
    if stitch and raw_images:
        loop = asyncio.get_event_loop()
        stitched = await loop.run_in_executor(None, stitch_images, raw_images)

    zip_data = await asyncio.get_event_loop().run_in_executor(
        None, create_zip, raw_images, manga_title, chapter
    )

    return {
        "raw": raw_images,
        "stitched": stitched,
        "zip": zip_data,
        "count": len(raw_images),
    }
