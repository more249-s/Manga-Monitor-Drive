import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("mychapters")
  .setDescription("View your active and recently completed chapters")
  .addUserOption((o) =>
    o.setName("user").setDescription("View another member's chapters (Admin)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser("user") || interaction.user;

  const { rows: active } = await pool.query(
    `SELECT c.chapter_number, c.status, c.role_needed, p.name as project_name, c.started_at
     FROM chapters c JOIN projects p ON c.project_id = p.id
     WHERE c.claimed_by = $1 AND c.status NOT IN ('completed', 'available')
     ORDER BY c.started_at DESC`,
    [target.id]
  );

  const { rows: completed } = await pool.query(
    `SELECT c.chapter_number, c.status, c.role_needed, p.name as project_name, c.completed_at,
            EXTRACT(EPOCH FROM (c.completed_at - c.started_at))/3600 as hours
     FROM chapters c JOIN projects p ON c.project_id = p.id
     WHERE c.claimed_by = $1 AND c.status = 'completed'
     ORDER BY c.completed_at DESC LIMIT 10`,
    [target.id]
  );

  const statusEmoji: Record<string, string> = {
    claimed: "🔵",
    translating: "🟠 TL",
    editing: "🟣 ED",
    completed: "✅",
  };

  const embed = new EmbedBuilder()
    .setTitle(`📚 ${target.username}'s Chapters`)
    .setColor("#0099ff")
    .setThumbnail(target.displayAvatarURL())
    .setTimestamp();

  if (active.length) {
    embed.addFields({
      name: `🔄 In Progress (${active.length})`,
      value: active
        .map((c: any) => `${statusEmoji[c.status] || "⚪"} **${c.project_name}** Ch.**${c.chapter_number}**`)
        .join("\n"),
      inline: false,
    });
  } else {
    embed.addFields({ name: "🔄 In Progress", value: "None", inline: false });
  }

  if (completed.length) {
    embed.addFields({
      name: `✅ Recently Completed`,
      value: completed
        .map(
          (c: any) =>
            `✅ **${c.project_name}** Ch.**${c.chapter_number}** — ${Math.round(c.hours || 0)}h`
        )
        .join("\n"),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: target.id !== interaction.user.id });
}
