import { BaseScraper, ScrapeResult } from "./baseScraper.js";
import { AsuraScraper } from "./asuraScraper.js";
import { NewtokiScraper } from "./newtokiScraper.js";
import { NirvanaScraper } from "./nirvanaScraper.js";
import { VortexScraper } from "./vortexScraper.js";
import { FlameScraper } from "./flameScraper.js";
import { ReaperScraper } from "./reaperScraper.js";
import { LuminousScraper } from "./luminousScraper.js";
import { MangadexScraper } from "./mangadexScraper.js";
import { GenericScraper } from "./genericScraper.js";
import { pool } from "../database/schema.js";

const scrapers: BaseScraper[] = [
  new AsuraScraper(),
  new NewtokiScraper(),
  new NirvanaScraper(),
  new VortexScraper(),
  new FlameScraper(),
  new ReaperScraper(),
  new LuminousScraper(),
  new MangadexScraper(),
  new GenericScraper(),
];

export function getScraperForUrl(url: string): BaseScraper {
  for (const scraper of scrapers) {
    if (scraper instanceof GenericScraper) continue;
    if (scraper.canHandle(url)) return scraper;
  }
  return scrapers[scrapers.length - 1];
}

export async function scrapeAllTrackedSources(): Promise<
  Array<{ projectId: number; projectName: string; channelId: string; result: ScrapeResult; previousChapter: number }>
> {
  const newChapters: Array<{
    projectId: number;
    projectName: string;
    channelId: string;
    result: ScrapeResult;
    previousChapter: number;
  }> = [];

  try {
    const { rows: sources } = await pool.query(`
      SELECT ts.id, ts.project_id, ts.source_url, ts.source_name, ts.last_chapter,
             p.name as project_name, p.channel_id, p.current_raw
      FROM tracked_sources ts
      JOIN projects p ON ts.project_id = p.id
      WHERE ts.enabled = true AND p.status = 'active'
    `);

    for (const source of sources) {
      try {
        const scraper = getScraperForUrl(source.source_url);
        const result = await scraper.getLatestChapter(source.source_url);

        if (!result) continue;

        const prevChapter = source.last_chapter || source.current_raw || 0;

        if (result.latestChapter > prevChapter) {
          await pool.query(
            "UPDATE tracked_sources SET last_chapter = $1 WHERE id = $2",
            [result.latestChapter, source.id]
          );

          await pool.query(
            "UPDATE projects SET current_raw = $1 WHERE id = $2 AND current_raw < $1",
            [result.latestChapter, source.project_id]
          );

          newChapters.push({
            projectId: source.project_id,
            projectName: source.project_name,
            channelId: source.channel_id,
            result,
            previousChapter: prevChapter,
          });

          await pool.query(
            "INSERT INTO logs (event_type, project_id, details) VALUES ($1, $2, $3)",
            ["RAW_DETECTED", source.project_id, `Chapter ${result.latestChapter} detected on ${source.source_name}`]
          );
        }
      } catch (err) {
        console.error(`[Scraper] Error on source ${source.source_url}:`, err);
      }
    }
  } catch (err) {
    console.error("[ScraperManager] DB error:", err);
  }

  return newChapters;
}

export async function getChapterImages(url: string): Promise<string[]> {
  const scraper = getScraperForUrl(url);
  return scraper.getChapterImages(url);
}

export { scrapers };
