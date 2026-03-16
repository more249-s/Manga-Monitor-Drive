import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import * as cheerio from "cheerio";
import axios from "axios";

export class GenericScraper extends BaseScraper {
  sourceName = "Generic";

  canHandle(_url: string): boolean {
    return true;
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);
      const chapters: ChapterInfo[] = [];

      const selectors = [
        ".wp-manga-chapter a",
        ".chapter-list a",
        ".chapter-link",
        "ul.main li a",
        "a[href*='chapter']",
        "a[href*='episode']",
        ".list-chapter a",
      ];

      for (const selector of selectors) {
        $(selector).each((_, el) => {
          const href = $(el).attr("href") || "";
          const text = $(el).text().trim();
          const match = text.match(/(?:chapter|ch|ep|episode)\s*[.#]?\s*(\d+(?:\.\d+)?)/i)
            || href.match(/(?:chapter|ch|ep)[/-](\d+(?:\.\d+)?)/i);
          if (match) {
            const num = parseFloat(match[1]);
            if (!isNaN(num) && num > 0) {
              const fullUrl = href.startsWith("http") ? href : new URL(href, url).href;
              const exists = chapters.some((c) => c.number === num);
              if (!exists) {
                chapters.push({ number: num, title: text, url: fullUrl, isFree: true });
              }
            }
          }
        });

        if (chapters.length > 0) break;
      }

      if (chapters.length === 0) return null;

      const latest = Math.max(...chapters.map((c) => c.number));
      const hostname = new URL(url).hostname.replace("www.", "");
      return {
        projectSlug: url,
        latestChapter: latest,
        chapters: chapters.filter((c) => c.number === latest),
        sourceName: hostname,
      };
    } catch (err) {
      console.error(`[Generic] Error scraping ${url}:`, err);
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

      const imgSelectors = [
        ".reading-content img",
        "#readerarea img",
        ".chapter-content img",
        ".comic-content img",
        "div.pages img",
        "img[data-src]",
        "img[data-original]",
      ];

      for (const sel of imgSelectors) {
        $(sel).each((_, el) => {
          const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original") || "";
          if (src.startsWith("http") && !images.includes(src)) {
            images.push(src.trim());
          }
        });
      }

      return images;
    } catch {
      return [];
    }
  }
}
