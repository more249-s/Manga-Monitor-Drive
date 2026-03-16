import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View team and project statistics");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { rows: monthlyChapters } = await pool.query(
    "SELECT COUNT(*) as count FROM chapters WHERE status = 'completed' AND EXTRACT(MONTH FROM completed_at) = $1 AND EXTRACT(YEAR FROM completed_at) = $2",
    [month, year]
  );

  const { rows: activeProjects } = await pool.query("SELECT COUNT(*) as count FROM projects WHERE status = 'active'");

  const { rows: activeMembers } = await pool.query(
    "SELECT COUNT(DISTINCT discord_id) as count FROM members"
  );

  const { rows: topTL } = await pool.query(
    `SELECT m.username, m.discord_id, COUNT(c.id) as chapters
     FROM chapters c
     JOIN members m ON c.claimed_by = m.discord_id
     WHERE c.status = 'completed' AND m.role = 'TL'
       AND EXTRACT(MONTH FROM c.completed_at) = $1
       AND EXTRACT(YEAR FROM c.completed_at) = $2
     GROUP BY m.username, m.discord_id
     ORDER BY chapters DESC LIMIT 1`,
    [month, year]
  );

  const { rows: topED } = await pool.query(
    `SELECT m.username, m.discord_id, COUNT(c.id) as chapters
     FROM chapters c
     JOIN members m ON c.claimed_by = m.discord_id
     WHERE c.status = 'completed' AND m.role = 'ED'
       AND EXTRACT(MONTH FROM c.completed_at) = $1
       AND EXTRACT(YEAR FROM c.completed_at) = $2
     GROUP BY m.username, m.discord_id
     ORDER BY chapters DESC LIMIT 1`,
    [month, year]
  );

  const { rows: fastestChapter } = await pool.query(
    `SELECT c.chapter_number, p.name, EXTRACT(EPOCH FROM (c.completed_at - c.started_at))/3600 as hours
     FROM chapters c JOIN projects p ON c.project_id = p.id
     WHERE c.started_at IS NOT NULL AND c.completed_at IS NOT NULL
       AND EXTRACT(MONTH FROM c.completed_at) = $1
       AND EXTRACT(YEAR FROM c.completed_at) = $2
     ORDER BY hours ASC LIMIT 1`,
    [month, year]
  );

  const embed = new EmbedBuilder()
    .setTitle(`📊 Team Stats — ${month}/${year}`)
    .setColor("#0099ff")
    .addFields(
      { name: "Chapters Completed", value: `${monthlyChapters[0]?.count || 0}`, inline: true },
      { name: "Active Projects", value: `${activeProjects[0]?.count || 0}`, inline: true },
      { name: "Team Members", value: `${activeMembers[0]?.count || 0}`, inline: true },
      {
        name: "Top Translator",
        value: topTL.length ? `<@${topTL[0].discord_id}> (${topTL[0].chapters} chapters)` : "—",
        inline: true,
      },
      {
        name: "Top Editor",
        value: topED.length ? `<@${topED[0].discord_id}> (${topED[0].chapters} chapters)` : "—",
        inline: true,
      },
      {
        name: "Fastest Chapter",
        value: fastestChapter.length
          ? `${fastestChapter[0].name} Ch.${fastestChapter[0].chapter_number} (${Math.round(fastestChapter[0].hours)}h)`
          : "—",
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
