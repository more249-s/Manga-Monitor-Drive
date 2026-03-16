import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("available")
  .setDescription("Show all available chapters ready to be claimed");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const { rows } = await pool.query(`
    SELECT c.*, p.name as project_name, p.project_type, p.chapter_payment
    FROM chapters c
    JOIN projects p ON c.project_id = p.id
    WHERE c.status = 'available' AND p.status = 'active'
    ORDER BY p.project_type DESC, p.name
  `);

  if (!rows.length) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Available Chapters")
          .setColor("#888888")
          .setDescription("No chapters available right now. Check back later!")
          .setTimestamp(),
      ],
    });
    return;
  }

  const exclusive = rows.filter((r: any) => r.project_type === "exclusive");
  const competitive = rows.filter((r: any) => r.project_type === "competitive");

  const formatRow = (r: any) => {
    const roleEmoji = r.role_needed === "TL" ? "🌐" : "✏️";
    return `${roleEmoji} **${r.project_name}** — Ch.**${r.chapter_number}** | $${r.chapter_payment}`;
  };

  const embed = new EmbedBuilder()
    .setTitle("📢 Available Chapters")
    .setColor("#ffaa00")
    .setTimestamp()
    .setFooter({ text: `${rows.length} chapter(s) available • Use /claim to pick one up` });

  if (exclusive.length) {
    embed.addFields({
      name: "🔴 Exclusive",
      value: exclusive.map(formatRow).join("\n"),
      inline: false,
    });
  }

  if (competitive.length) {
    embed.addFields({
      name: "🔷 Competitive",
      value: competitive.map(formatRow).join("\n"),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
