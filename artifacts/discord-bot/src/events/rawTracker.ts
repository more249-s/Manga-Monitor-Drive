import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import cron from "node-cron";
import { scrapeAllTrackedSources } from "../scrapers/scraperManager.js";
import { getChapterImages } from "../scrapers/scraperManager.js";
import { downloadAndUploadChapter } from "../services/driveService.js";
import { pool } from "../database/schema.js";
import { CONFIG } from "../utils/config.js";

export function startRawTracker(client: Client): void {
  const intervalMinutes = CONFIG.SCRAPE_INTERVAL_MINUTES;
  console.log(`[Tracker] Starting RAW tracker — checking every ${intervalMinutes} minutes`);

  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    console.log("[Tracker] Checking for new RAW chapters...");

    try {
      const newChapters = await scrapeAllTrackedSources();

      for (const { projectId, projectName, channelId, result, previousChapter } of newChapters) {
        if (!channelId) continue;

        try {
          const channel = await client.channels.fetch(channelId) as TextChannel;
          if (!channel) continue;

          const { rows: proj } = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
          const project = proj[0];
          if (!project) continue;

          const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";
          const chapterInfo = result.chapters[0];

          const notifEmbed = new EmbedBuilder()
            .setTitle("🚨 New RAW Chapter Detected!")
            .setColor("#ff4444")
            .addFields(
              { name: "Work", value: `${typeIcon} ${projectName}`, inline: true },
              { name: "Chapter", value: `${result.latestChapter}`, inline: true },
              { name: "Source", value: result.sourceName, inline: true },
              { name: "RAW Link", value: chapterInfo?.url || "—", inline: false }
            )
            .setTimestamp();

          let mention = "";
          if (project.translator_id) mention = `<@${project.translator_id}>`;
          if (project.editor_id) mention += ` <@${project.editor_id}>`;

          await channel.send({ content: mention || undefined, embeds: [notifEmbed] });

          if (chapterInfo?.isFree && chapterInfo.url) {
            console.log(`[Tracker] Attempting auto-download for ${projectName} Ch.${result.latestChapter}`);

            try {
              const images = await getChapterImages(chapterInfo.url);

              if (images.length > 0) {
                const driveLink = await downloadAndUploadChapter(projectName, result.latestChapter, images);

                if (driveLink) {
                  await pool.query(
                    `INSERT INTO chapters (project_id, chapter_number, status, raw_url, drive_url)
                     VALUES ($1, $2, 'available', $3, $4)
                     ON CONFLICT (project_id, chapter_number) DO UPDATE SET raw_url = $3, drive_url = $4`,
                    [projectId, result.latestChapter, chapterInfo.url, driveLink]
                  );

                  await channel.send({
                    embeds: [
                      new EmbedBuilder()
                        .setTitle("📥 RAW Auto-Downloaded!")
                        .setColor("#00cc44")
                        .addFields(
                          { name: "Chapter", value: `${result.latestChapter}`, inline: true },
                          { name: "Pages", value: `${images.length}`, inline: true },
                          { name: "Drive Link", value: driveLink }
                        )
                        .setTimestamp(),
                    ],
                  });
                }
              }
            } catch (dlErr) {
              console.error("[Tracker] Auto-download error:", dlErr);
            }
          }
        } catch (err) {
          console.error(`[Tracker] Error notifying for project ${projectId}:`, err);
        }
      }
    } catch (err) {
      console.error("[Tracker] General error:", err);
    }
  });
}
