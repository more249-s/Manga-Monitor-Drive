import { BaseScraper, ChapterInfo, ScrapeResult } from "./baseScraper.js";
import axios from "axios";

export class MangadexScraper extends BaseScraper {
  sourceName = "MangaDex";
  private baseApi = "https://api.mangadex.org";

  canHandle(url: string): boolean {
    return url.includes("mangadex.org");
  }

  private extractMangaId(url: string): string | null {
    const match = url.match(/mangadex\.org\/title\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  async getLatestChapter(url: string): Promise<ScrapeResult | null> {
    try {
      const mangaId = this.extractMangaId(url);
      if (!mangaId) return null;

      const res = await axios.get(`${this.baseApi}/chapter`, {
        params: {
          manga: mangaId,
          "order[chapter]": "desc",
          limit: 10,
          translatedLanguage: ["en", "ko"],
        },
        timeout: 15000,
      });

      const data = res.data?.data || [];
      if (!data.length) return null;

      const chapters: ChapterInfo[] = data.map((ch: any) => ({
        number: parseFloat(ch.attributes.chapter || "0"),
        title: ch.attributes.title,
        url: `https://mangadex.org/chapter/${ch.id}`,
        isFree: true,
      }));

      const latest = Math.max(...chapters.map((c) => c.number));
      return {
        projectSlug: url,
        latestChapter: latest,
        chapters: chapters.filter((c) => c.number === latest),
        sourceName: this.sourceName,
      };
    } catch (err) {
      console.error("[MangaDex] Error:", err);
      return null;
    }
  }

  async getChapterImages(chapterUrl: string): Promise<string[]> {
    try {
      const chapterId = chapterUrl.split("/chapter/")[1]?.split("/")[0];
      if (!chapterId) return [];

      const res = await axios.get(`${this.baseApi}/at-home/server/${chapterId}`, { timeout: 15000 });
      const { baseUrl, chapter } = res.data;
      return chapter.data.map((file: string) => `${baseUrl}/data/${chapter.hash}/${file}`);
    } catch {
      return [];
    }
  }
}
