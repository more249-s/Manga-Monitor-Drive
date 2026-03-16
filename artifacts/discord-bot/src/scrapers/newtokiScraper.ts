import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import * as cheerio from "cheerio";
import axios from "axios";

export class NewtokiScraper extends BaseScraper {
  sourceName = "NewToki";

  canHandle(url: string): boolean {
    return url.includes("newtoki") || url.includes("manatoki") || url.includes("toonkor");
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const chapters: ChapterInfo[] = [];

      $("ul.list-body li, .chapter-list li, a[href*='episode']").each((_, el) => {
        const link = $(el).find("a").first();
        const href = link.attr("href") || $(el).attr("href") || "";
        const text = link.text().trim() || $(el).text().trim();
        const match = text.match(/(\d+(?:\.\d+)?)/);
        if (match && href) {
          const num = parseFloat(match[1]);
          if (!isNaN(num)) {
            const fullUrl = href.startsWith("http") ? href : new URL(href, url).href;
            chapters.push({
              number: num,
              title: text,
              url: fullUrl,
              isFree: !text.toLowerCase().includes("무료") && !$(el).hasClass("locked"),
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
      console.error(`[NewToki] Error scraping ${url}:`, err);
      return null;
    }
  }

  async getChapterImages(chapterUrl: string): Promise<string[]> {
    try {
      const res = await axios.get(chapterUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": chapterUrl,
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const images: string[] = [];

      $("div#comic-content img, .viewer-images img, img[data-original], img[data-src]").each((_, el) => {
        const src = $(el).attr("data-original") || $(el).attr("data-src") || $(el).attr("src") || "";
        if (src && src.startsWith("http")) {
          images.push(src);
        }
      });

      return images;
    } catch (err) {
      console.error(`[NewToki] Error fetching images:`, err);
      return [];
    }
  }
}
