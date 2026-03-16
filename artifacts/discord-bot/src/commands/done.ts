import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";
import { recordSalary } from "../services/salaryService.js";
import { updateProjectDashboard, sendLogEvent } from "../services/dashboardService.js";

async function finishChapter(
  interaction: ChatInputCommandInteraction,
  expectedRole: "TL" | "ED"
): Promise<void> {
  await interaction.deferReply();

  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("chapter", true);

  const { rows: proj } = await pool.query("SELECT * FROM projects WHERE slug = $1 OR LOWER(name) = LOWER($1)", [projectSlug]);
  if (!proj.length) {
    await interaction.editReply(`❌ Project \`${projectSlug}\` not found. Try using the slug name.`);
    return;
  }

  const project = proj[0];

  const { rows: ch } = await pool.query(
    "SELECT * FROM chapters WHERE project_id = $1 AND chapter_number = $2",
    [project.id, chapterNumber]
  );

  if (!ch.length) {
    await interaction.editReply(`❌ Chapter **${chapterNumber}** not found for **${project.name}**.`);
    return;
  }

  const chapter = ch[0];

  if (chapter.claimed_by !== interaction.user.id) {
    await interaction.editReply(`❌ You didn't claim Chapter **${chapterNumber}** of **${project.name}**.`);
    return;
  }

  const roleLabel = expectedRole === "TL" ? "Translation" : "Editing";
  const newStatus = expectedRole === "TL" ? "translating_done" : "completed";

  if (expectedRole === "TL") {
    await pool.query(
      "UPDATE chapters SET status = 'editing', started_at = COALESCE(started_at, NOW()) WHERE id = $1",
      [chapter.id]
    );
  } else {
    await pool.query(
      "UPDATE chapters SET status = 'completed', completed_at = NOW() WHERE id = $1",
      [chapter.id]
    );
    await pool.query("UPDATE members SET total_chapters = total_chapters + 1 WHERE discord_id = $1", [
      interaction.user.id,
    ]);
    await recordSalary(interaction.user.id, project.id, chapter.id, expectedRole, parseFloat(project.chapter_payment));
  }

  const timeTaken = chapter.started_at
    ? `${Math.round((Date.now() - new Date(chapter.started_at).getTime()) / 3600000)}h`
    : "—";

  await updateProjectDashboard(interaction.client, project.id);
  await sendLogEvent(
    interaction.client,
    interaction.guildId!,
    "CHAPTER_COMPLETED",
    `${interaction.user.username} finished ${roleLabel} for ${project.name} Ch.${chapterNumber}`
  );

  const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";

  const embed = new EmbedBuilder()
    .setTitle(expectedRole === "ED" ? "✅ Chapter Done!" : "✅ Translation Done!")
    .setColor("#00cc44")
    .addFields(
      { name: "Work", value: `${typeIcon} ${project.name}`, inline: true },
      { name: "Chapter", value: `${chapterNumber}`, inline: true },
      { name: "Time", value: timeTaken, inline: true },
      { name: "Earned", value: `$${project.chapter_payment}`, inline: true },
      {
        name: "Next Step",
        value: expectedRole === "TL" ? "Waiting for Editor ✏️" : "Ready for Release 🚀",
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export const tldoneData = new SlashCommandBuilder()
  .setName("tldone")
  .setDescription("Mark your translation as done for a chapter")
  .addStringOption((o) => o.setName("project").setDescription("Project name or slug").setRequired(true))
  .addIntegerOption((o) => o.setName("chapter").setDescription("Chapter number").setRequired(true));

export async function executeTldone(interaction: ChatInputCommandInteraction): Promise<void> {
  await finishChapter(interaction, "TL");
}

export const eddoneData = new SlashCommandBuilder()
  .setName("eddone")
  .setDescription("Mark your editing as done for a chapter")
  .addStringOption((o) => o.setName("project").setDescription("Project name or slug").setRequired(true))
  .addIntegerOption((o) => o.setName("chapter").setDescription("Chapter number").setRequired(true));

export async function executeEddone(interaction: ChatInputCommandInteraction): Promise<void> {
  await finishChapter(interaction, "ED");
}
