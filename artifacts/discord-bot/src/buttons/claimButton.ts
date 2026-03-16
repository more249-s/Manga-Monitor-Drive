import {
  ButtonInteraction,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { pool } from "../database/schema.js";
import { recordSalary } from "../services/salaryService.js";
import { updateProjectDashboard, sendLogEvent } from "../services/dashboardService.js";
import { CONFIG } from "../utils/config.js";

export async function handleClaimButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (!customId.startsWith("claim_")) return;

  const parts = customId.split("_");
  const projectId = parseInt(parts[1]);
  const chapterNumber = parseInt(parts[2]);

  await interaction.deferReply({ ephemeral: true });

  const { rows: chapterRows } = await pool.query(
    "SELECT * FROM chapters WHERE project_id = $1 AND chapter_number = $2",
    [projectId, chapterNumber]
  );

  const chapter = chapterRows[0];
  if (!chapter) {
    await interaction.editReply({ content: "This chapter no longer exists." });
    return;
  }

  if (chapter.status !== "available") {
    await interaction.editReply({ content: "This chapter has already been claimed." });
    return;
  }

  const { rows: projectRows } = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  const project = projectRows[0];
  if (!project) {
    await interaction.editReply({ content: "Project not found." });
    return;
  }

  const { rows: memberRows } = await pool.query(
    "SELECT * FROM members WHERE discord_id = $1",
    [interaction.user.id]
  );

  const member = memberRows[0];
  if (!member) {
    await interaction.editReply({
      content: "You are not registered. Ask an admin to add you with `/member add`.",
    });
    return;
  }

  const requiredRole = chapter.role_needed;
  if (requiredRole === "TL" && member.role !== "TL") {
    await interaction.editReply({ content: "This chapter needs a Translator (TL)." });
    return;
  }
  if (requiredRole === "ED" && member.role !== "ED") {
    await interaction.editReply({ content: "This chapter needs an Editor (ED)." });
    return;
  }

  const { rows: activeChapters } = await pool.query(
    "SELECT id FROM chapters WHERE claimed_by = $1 AND status IN ('claimed', 'translating', 'editing')",
    [interaction.user.id]
  );

  if (activeChapters.length >= 3) {
    await interaction.editReply({
      content: "You already have 3 active chapters. Finish one before claiming another.",
    });
    return;
  }

  await pool.query(
    `UPDATE chapters SET status = 'claimed', claimed_by = $1, started_at = NOW() WHERE project_id = $2 AND chapter_number = $3`,
    [interaction.user.id, projectId, chapterNumber]
  );

  if (requiredRole === "TL") {
    await pool.query("UPDATE projects SET translator_id = $1, current_working = $2 WHERE id = $3", [
      interaction.user.id,
      chapterNumber,
      projectId,
    ]);
  } else {
    await pool.query("UPDATE projects SET editor_id = $1 WHERE id = $2", [
      interaction.user.id,
      projectId,
    ]);
  }

  const claimedEmbed = new EmbedBuilder()
    .setTitle("✅ Chapter Claimed!")
    .setColor("#00cc44")
    .setDescription(
      `**${project.name}** — Chapter ${chapterNumber}\n\nClaimed by: <@${interaction.user.id}>`
    )
    .setTimestamp();

  if (chapter.claim_message_id && chapter.claim_channel_id) {
    try {
      const claimChannel = await interaction.client.channels.fetch(chapter.claim_channel_id) as TextChannel;
      const claimMsg = await claimChannel.messages.fetch(chapter.claim_message_id);

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`claimed_${projectId}_${chapterNumber}`)
          .setLabel(`Claimed by ${interaction.user.username}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      await claimMsg.edit({ components: [disabledRow] });
    } catch {}
  }

  if (project.channel_id) {
    try {
      const projectChannel = await interaction.client.channels.fetch(project.channel_id) as TextChannel;
      const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";
      await projectChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📌 Chapter ${chapterNumber} — ${requiredRole === "TL" ? "Translator" : "Editor"} Claimed`)
            .setColor("#0099ff")
            .setDescription(
              `${typeIcon} **${project.name}**\n\n${requiredRole === "TL" ? "Translator" : "Editor"}: <@${interaction.user.id}>`
            )
            .setTimestamp(),
        ],
      });
    } catch {}
  }

  await updateProjectDashboard(interaction.client, projectId);
  await sendLogEvent(
    interaction.client,
    interaction.guildId!,
    "CHAPTER_CLAIMED",
    `${interaction.user.username} claimed Chapter ${chapterNumber} of ${project.name}`
  );

  await pool.query(
    "INSERT INTO logs (event_type, project_id, chapter_id, discord_id, details) VALUES ($1, $2, $3, $4, $5)",
    ["CHAPTER_CLAIMED", projectId, chapter.id, interaction.user.id, `Chapter ${chapterNumber} claimed`]
  );

  setTimeout(async () => {
    const { rows: check } = await pool.query(
      "SELECT status FROM chapters WHERE project_id = $1 AND chapter_number = $2",
      [projectId, chapterNumber]
    );
    if (check[0]?.status === "claimed") {
      await pool.query(
        `UPDATE chapters SET status = 'available', claimed_by = NULL, started_at = NULL WHERE project_id = $1 AND chapter_number = $2`,
        [projectId, chapterNumber]
      );
      if (project.channel_id) {
        try {
          const ch = await interaction.client.channels.fetch(project.channel_id) as TextChannel;
          await ch.send(
            `⚠️ Chapter **${chapterNumber}** of **${project.name}** was auto-released — <@${interaction.user.id}> did not start within ${CONFIG.CHAPTER_CLAIM_TIMEOUT_HOURS} hours.`
          );
        } catch {}
      }
    }
  }, CONFIG.CHAPTER_CLAIM_TIMEOUT_HOURS * 60 * 60 * 1000);

  await interaction.editReply({ content: `You claimed Chapter ${chapterNumber} of **${project.name}**! Get started!` });
}
