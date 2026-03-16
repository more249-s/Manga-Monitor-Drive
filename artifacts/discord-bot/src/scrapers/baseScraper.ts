export interface ChapterInfo {
  number: number;
  title?: string;
  url: string;
  isFree: boolean;
  imageUrls?: string[];
}

export interface ScrapeResult {
  projectSlug: string;
  latestChapter: number;
  chapters: ChapterInfo[];
  sourceName: string;
}

export abstract class BaseScraper {
  abstract sourceName: string;
  abstract canHandle(url: string): boolean;
  abstract getLatestChapter(url: string): Promise<ScrapeResult | null>;
  abstract getChapterImages(chapterUrl: string): Promise<string[]>;
}
