"""
Multi-site scraper with Cloudflare bypass via cloudscraper.
Supports: Asura, NewToki, Nirvana, Vortex, Flame, Reaper, Luminous,
          Bato, Manganelo, Mangakakalot, Webtoon, Tapas, MangaDex (API),
          Kunmanga, Toonily, Isekaiscan, Manhuaplus, and Generic.
"""

import re
import asyncio
import json
from typing import Optional, Tuple, List
from urllib.parse import urlparse, urljoin

import cloudscraper
import requests
from bs4 import BeautifulSoup


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Referer": "https://google.com/",
}


def _make_scraper():
    return cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "desktop": True},
        delay=5,
    )


def _fetch_html(url: str) -> Optional[str]:
    scraper = _make_scraper()
    try:
        resp = scraper.get(url, headers=HEADERS, timeout=25)
        if resp.status_code == 200:
            return resp.text
        print(f"[Scraper] HTTP {resp.status_code} for {url}")
    except Exception as e:
        print(f"[Scraper] Fetch error for {url}: {e}")
    return None


def _detect_site(url: str) -> str:
    domain = urlparse(url).netloc.lower()
    sites = {
        "asura": "asura",
        "newtoki": "newtoki",
        "nirvana": "nirvana",
        "vortex": "vortex",
        "flame": "flame",
        "reaper": "reaper",
        "luminous": "luminous",
        "bato": "bato",
        "manganelo": "manganelo",
        "mangakakalot": "mangakakalot",
        "webtoon": "webtoon",
        "tapas": "tapas",
        "mangadex": "mangadex",
        "kunmanga": "kunmanga",
        "toonily": "toonily",
        "isekaiscan": "isekaiscan",
        "manhuaplus": "manhuaplus",
        "reaperscans": "reaper",
        "flamecomics": "flame",
        "asurascans": "asura",
        "luminousscans": "luminous",
        "nitroscans": "nitro",
        "lscomic": "lscomic",
        "manhwatop": "manhwatop",
        "manwha18": "generic",
        "hiperdex": "hiperdex",
        "mangabuddy": "mangabuddy",
        "comickiba": "generic",
        "manhwa365": "generic",
        "s2manga": "generic",
        "chapmanganato": "manganelo",
    }
    for key, name in sites.items():
        if key in domain:
            return name
    return "generic"


def _extract_chapters_generic(html: str, current_ch: float) -> List[float]:
    soup = BeautifulSoup(html, "html.parser")
    chapters = []
    patterns = [
        r"(?i)(?:chapter|ch|ep|الفصل|فصل)[.\s\-:]*(\d+(?:\.\d+)?)",
        r"/chapter[s]?[-/](\d+(?:\.\d+)?)",
        r"/ch[-/]?(\d+(?:\.\d+)?)",
        r"episode[s]?[-/\s]?(\d+(?:\.\d+)?)",
    ]
    for el in soup.find_all(["li", "div", "a", "span", "h3", "p"]):
        text = el.get_text(" ", strip=True)
        href = el.get("href", "") if el.name == "a" else ""
        combined = f"{text} {href}"
        for pat in patterns:
            for m in re.finditer(pat, combined):
                try:
                    chapters.append(float(m.group(1)))
                except ValueError:
                    pass
    return chapters


# ─────────────────────── Site-specific scrapers ───────────────────────

def _scrape_mangadex(url: str, current_ch: float) -> Optional[float]:
    """Use MangaDex API directly — no Cloudflare."""
    m = re.search(r"manga/([0-9a-f\-]{36})", url)
    if not m:
        return None
    manga_id = m.group(1)
    api = f"https://api.mangadex.org/manga/{manga_id}/feed?limit=100&order[chapter]=desc&translatedLanguage[]=en"
    try:
        resp = requests.get(api, timeout=15)
        data = resp.json()
        for ch in data.get("data", []):
            ch_num = ch.get("attributes", {}).get("chapter")
            if ch_num:
                try:
                    num = float(ch_num)
                    if num > current_ch:
                        return num
                except ValueError:
                    pass
    except Exception as e:
        print(f"[MangaDex] API error: {e}")
    return None


def _scrape_webtoon(html: str, current_ch: float) -> Optional[float]:
    soup = BeautifulSoup(html, "html.parser")
    chapters = []
    for el in soup.select("ul#_listUl li, .episode-list li"):
        ep = el.get("data-episode-no") or el.get("data-episode-seq", "")
        if ep:
            try:
                chapters.append(float(ep))
            except ValueError:
                pass
    if not chapters:
        chapters = _extract_chapters_generic(html, current_ch)
    valid = [c for c in chapters if current_ch < c <= current_ch + 10]
    return max(valid) if valid else None


def _scrape_bato(html: str, current_ch: float) -> Optional[float]:
    soup = BeautifulSoup(html, "html.parser")
    chapters = []
    for a in soup.select("a[href*='/chapter']"):
        m = re.search(r"/chapter[s]?/(\d+(?:\.\d+)?)", a.get("href", ""))
        if m:
            try:
                chapters.append(float(m.group(1)))
            except ValueError:
                pass
    valid = [c for c in chapters if current_ch < c <= current_ch + 10]
    return max(valid) if valid else None


# ────────────────────────── Main entry ────────────────────────────────

async def fetch_latest_chapter(url: str, current_ch: float) -> Optional[float]:
    site = _detect_site(url)
    loop = asyncio.get_event_loop()

    # MangaDex uses official API
    if site == "mangadex":
        return await loop.run_in_executor(None, _scrape_mangadex, url, current_ch)

    html = await loop.run_in_executor(None, _fetch_html, url)
    if not html:
        return None

    if site == "webtoon":
        return await loop.run_in_executor(None, _scrape_webtoon, html, current_ch)
    if site == "bato":
        return await loop.run_in_executor(None, _scrape_bato, html, current_ch)

    # Generic extraction for all other sites
    chapters = await loop.run_in_executor(None, _extract_chapters_generic, html, current_ch)
    valid = [c for c in chapters if current_ch < c <= current_ch + 10]
    return max(valid) if valid else None


# ──────────────────── Image URL extractor ─────────────────────────────

async def get_chapter_image_urls(chapter_url: str, site: str = "auto") -> List[str]:
    """Extract all image URLs from a chapter page."""
    if site == "auto":
        site = _detect_site(chapter_url)

    loop = asyncio.get_event_loop()

    if site == "mangadex":
        return await loop.run_in_executor(None, _get_mangadex_images, chapter_url)

    html = await loop.run_in_executor(None, _fetch_html, chapter_url)
    if not html:
        return []

    return await loop.run_in_executor(None, _extract_images_generic, html, chapter_url)


def _get_mangadex_images(chapter_url: str) -> List[str]:
    m = re.search(r"chapter/([0-9a-f\-]{36})", chapter_url)
    if not m:
        return []
    ch_id = m.group(1)
    try:
        resp = requests.get(f"https://api.mangadex.org/at-home/server/{ch_id}", timeout=15)
        data = resp.json()
        base_url = data["baseUrl"]
        ch_hash = data["chapter"]["hash"]
        pages = data["chapter"]["data"]
        return [f"{base_url}/data/{ch_hash}/{p}" for p in pages]
    except Exception as e:
        print(f"[MangaDex] Image fetch error: {e}")
        return []


def _extract_images_generic(html: str, page_url: str) -> List[str]:
    soup = BeautifulSoup(html, "html.parser")
    base = f"{urlparse(page_url).scheme}://{urlparse(page_url).netloc}"
    images = []
    selectors = [
        "div.page-break img",
        "div.reading-content img",
        "div#readerarea img",
        "div.chapter-content img",
        "div.content-inner img",
        "div.viewer-cnt img",
        "div.comic-reading img",
        "img.wp-manga-chapter-img",
        "img[data-src]",
        "img[data-lazy-src]",
        "img[data-original]",
        ".read-content img",
        "#chapter-reader img",
        ".chapter-reader img",
    ]
    found = set()
    for sel in selectors:
        for img in soup.select(sel):
            src = (img.get("data-src") or img.get("data-lazy-src")
                   or img.get("data-original") or img.get("src") or "")
            src = src.strip()
            if src and src not in found and src.startswith("http"):
                found.add(src)
                images.append(src)

    # JSON inside script tags (some sites load images via JS)
    if not images:
        for script in soup.find_all("script"):
            text = script.string or ""
            urls = re.findall(r'https?://[^\s\'"<>]+\.(?:jpg|jpeg|png|webp)', text)
            for u in urls:
                if u not in found:
                    found.add(u)
                    images.append(u)

    return images
