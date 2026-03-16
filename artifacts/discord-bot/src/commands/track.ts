import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("track")
  .setDescription("View full status of a project — all chapters, team, and RAW info")
  .addStringOption((o) =>
    o.setName("project").setDescription("Project name or slug").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const input = interaction.options.getString("project", true);

  const { rows: proj } = await pool.query(
    "SELECT * FROM projects WHERE slug = $1 OR LOWER(name) = LOWER($1) OR name ILIKE $2",
    [input, `%${input}%`]
  );

  if (!proj.length) {
    await interaction.editReply(`❌ No project found matching \`${input}\`. Try /project list.`);
    return;
  }

  const project = proj[0];
  const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";

  const { rows: sources } = await pool.query(
    "SELECT * FROM tracked_sources WHERE project_id = $1",
    [project.id]
  );

  const { rows: activeChapters } = await pool.query(
    `SELECT c.chapter_number, c.status, c.role_needed, c.claimed_by,
            m.username, c.started_at, c.drive_url
     FROM chapters c LEFT JOIN members m ON c.claimed_by = m.discord_id
     WHERE c.project_id = $1 AND c.status != 'available'
     ORDER BY c.chapter_number DESC LIMIT 15`,
    [project.id]
  );

  const { rows: availableChapters } = await pool.query(
    "SELECT chapter_number, role_needed FROM chapters WHERE project_id = $1 AND status = 'available' ORDER BY chapter_number",
    [project.id]
  );

  const statusEmoji: Record<string, string> = {
    claimed: "🔵 Claimed",
    translating: "🟠 Translating",
    editing: "🟣 Editing",
    completed: "✅ Done",
  };

  const embed = new EmbedBuilder()
    .setTitle(`${typeIcon} ${project.name}`)
    .setColor(project.project_type === "exclusive" ? "#ff4444" : "#4488ff")
    .addFields(
      { name: "📖 Latest RAW", value: `Ch. **${project.current_raw || "—"}**`, inline: true },
      { name: "🔧 Working On", value: `Ch. **${project.current_working || "—"}**`, inline: true },
      { name: "💰 Pay/Chapter", value: `$${project.chapter_payment}`, inline: true }
    );

  if (sources.length) {
    embed.addFields({
      name: "🌐 Tracked Sources",
      value: sources
        .map((s: any) => `• **${s.source_name}** — Last seen: Ch.**${s.last_chapter || "?"}**\n  ${s.source_url}`)
        .join("\n"),
      inline: false,
    });
  }

  if (availableChapters.length) {
    embed.addFields({
      name: `📢 Available to Claim (${availableChapters.length})`,
      value: availableChapters
        .map((c: any) => `• Ch.**${c.chapter_number}** — needs ${c.role_needed === "TL" ? "🌐 Translator" : "✏️ Editor"}`)
        .join("\n"),
      inline: false,
    });
  }

  if (activeChapters.length) {
    embed.addFields({
      name: `🔄 In Progress`,
      value: activeChapters
        .map((c: any) => {
          const driveLink = c.drive_url ? ` [[Drive]](${c.drive_url})` : "";
          const elapsed = c.started_at
            ? `${Math.round((Date.now() - new Date(c.started_at).getTime()) / 3600000)}h`
            : "—";
          return `${statusEmoji[c.status] || "⚪"} Ch.**${c.chapter_number}** — ${c.username || "—"} (${elapsed})${driveLink}`;
        })
        .join("\n"),
      inline: false,
    });
  }

  embed.setTimestamp().setFooter({ text: `Slug: ${project.slug} • Status: ${project.status}` });

  await interaction.editReply({ embeds: [embed] });
}
