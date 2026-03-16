import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import * as cheerio from "cheerio";
import axios from "axios";

export class AsuraScraper extends BaseScraper {
  sourceName = "Asura Scans";

  canHandle(url: string): boolean {
    return url.includes("asuracomic.net") || url.includes("asurascans.com");
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const chapters: ChapterInfo[] = [];

      $("div.chapters-container a, .chapter-list a, a[href*='chapter']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        const match = text.match(/Chapter\s*(\d+(?:\.\d+)?)/i) || href.match(/chapter[/-](\d+(?:\.\d+)?)/i);
        if (match) {
          const num = parseFloat(match[1]);
          if (!isNaN(num)) {
            const fullUrl = href.startsWith("http") ? href : `https://asuracomic.net${href}`;
            chapters.push({
              number: num,
              title: text,
              url: fullUrl,
              isFree: true,
            });
          }
        }
      });

      if (chapters.length === 0) return null;

      const latest = Math.max(...chapters.map((c) => c.number));
      return {
        projectSlug: url,
        latestChapter: latest,
        chapters: chapters.filter((c) => c.number === latest),
        sourceName: this.sourceName,
      };
    } catch (err) {
      console.error(`[Asura] Error scraping ${url}:`, err);
      return null;
    }
  }

  async getChapterImages(chapterUrl: string): Promise<string[]> {
    try {
      const res = await axios.get(chapterUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://asuracomic.net",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const images: string[] = [];

      $("div.reader-container img, .chapter-images img, img[src*='cdn'], img[data-src*='cdn']").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        if (src && (src.includes("cdn") || src.includes("chapter") || src.includes("manga"))) {
          images.push(src);
        }
      });

      return images;
    } catch (err) {
      console.error(`[Asura] Error fetching images:`, err);
      return [];
    }
  }
}
