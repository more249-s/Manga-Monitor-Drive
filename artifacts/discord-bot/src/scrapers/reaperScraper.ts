import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import * as cheerio from "cheerio";
import axios from "axios";

export class ReaperScraper extends BaseScraper {
  sourceName = "Reaper Scans";

  canHandle(url: string): boolean {
    return url.includes("reaperscans.com") || url.includes("reaper-scans");
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 15000,
      });
      const $ = cheerio.load(res.data);
      const chapters: ChapterInfo[] = [];

      $("ul li a[href*='chapter'], a[href*='/chapter/']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        const match = href.match(/chapter[/-](\d+(?:\.\d+)?)/i) || text.match(/Chapter\s*(\d+(?:\.\d+)?)/i);
        if (match) {
          const num = parseFloat(match[1]);
          if (!isNaN(num)) {
            const fullUrl = href.startsWith("http") ? href : `https://reaperscans.com${href}`;
            chapters.push({ number: num, title: text, url: fullUrl, isFree: true });
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
    } catch {
      return null;
    }
  }

  async getChapterImages(chapterUrl: string): Promise<string[]> {
    try {
      const res = await axios.get(chapterUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://reaperscans.com" },
        timeout: 15000,
      });
      const $ = cheerio.load(res.data);
      const images: string[] = [];
      $("img[src*='cdn'], img[data-src], .chapter-reader img").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        if (src.startsWith("http")) images.push(src.trim());
      });
      return images;
    } catch {
      return [];
    }
  }
}
