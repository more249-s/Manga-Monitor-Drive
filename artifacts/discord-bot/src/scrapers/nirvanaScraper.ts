import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import * as cheerio from "cheerio";
import axios from "axios";

export class NirvanaScraper extends BaseScraper {
  sourceName = "Nirvana Scans";

  canHandle(url: string): boolean {
    return url.includes("nirvanascans.com") || url.includes("nirvana-scans");
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const chapters: ChapterInfo[] = [];

      $(".wp-manga-chapter a, .chapter-link, li.wp-manga-chapter a").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        const match = text.match(/Chapter\s*(\d+(?:\.\d+)?)/i) || href.match(/chapter[/-](\d+(?:\.\d+)?)/i);
        if (match) {
          const num = parseFloat(match[1]);
          if (!isNaN(num)) {
            chapters.push({ number: num, title: text, url: href, isFree: true });
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
      console.error(`[Nirvana] Error:`, err);
      return null;
    }
  }

  async getChapterImages(chapterUrl: string): Promise<string[]> {
    try {
      const res = await axios.get(chapterUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": chapterUrl },
        timeout: 15000,
      });
      const $ = cheerio.load(res.data);
      const images: string[] = [];
      $(".reading-content img, .page-break img").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        if (src.startsWith("http")) images.push(src.trim());
      });
      return images;
    } catch {
      return [];
    }
  }
}
