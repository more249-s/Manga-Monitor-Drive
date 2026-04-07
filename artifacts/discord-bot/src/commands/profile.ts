import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";
import { getMonthlySalary, getTotalSalary } from "../services/salaryService.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View a member's profile")
  .addUserOption((o) =>
    o
      .setName("user")
      .setDescription("Member to view (leave empty for yourself)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const target = interaction.options.getUser("user") || interaction.user;

  const { rows } = await pool.query(
    "SELECT * FROM members WHERE discord_id = $1",
    [target.id],
  );

  if (!rows.length) {
    await interaction.reply({
      content:
        target.id === interaction.user.id
          ? "You are not registered. Ask an admin to add you."
          : `<@${target.id}> is not registered.`,
      ephemeral: true,
    });
    return;
  }

  const member = rows[0];

  const monthlySalary = await getMonthlySalary(target.id);
  const totalEarned = await getTotalSalary(target.id);
  const monthTotal = monthlySalary.reduce((sum, s) => sum + s.amount, 0);
  const monthChapters = monthlySalary.reduce((sum, s) => sum + s.chapters, 0);

  const { rows: activeChapters } = await pool.query(
    `SELECT c.chapter_number, p.name as project_name, c.status
     FROM chapters c JOIN projects p ON c.project_id = p.id
     WHERE c.claimed_by = $1 AND c.status NOT IN ('completed', 'available')`,
    [target.id],
  );

  const roleLabels: Record<string, string> = {
    TL: "🌐 Translator",
    ED: "✏️ Editor",
    TR: "🎓 Trainee",
  };

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .setColor("#0099ff")
    .addFields(
      {
        name: "Role",
        value: roleLabels[member.role] || member.role,
        inline: true,
      },
      { name: "Rate", value: `$${member.chapter_rate}/chapter`, inline: true },
      {
        name: "Payment",
        value: member.payment_method || "Not set",
        inline: true,
      },
      {
        name: "Total Chapters",
        value: `${member.total_chapters}`,
        inline: true,
      },
      { name: "This Month", value: `${monthChapters} chapters`, inline: true },
      {
        name: "Monthly Earnings",
        value: `$${monthTotal.toFixed(2)}`,
        inline: true,
      },
      {
        name: "Total Earned",
        value: `$${totalEarned.toFixed(2)}`,
        inline: true,
      },
      {
        name: "Active Chapters",
        value:
          activeChapters.length > 0
            ? activeChapters
                .map(
                  (c: any) =>
                    `• ${c.project_name} Ch.${c.chapter_number} (${c.status})`,
                )
                .join("\n")
            : "None",
        inline: false,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
export default { data, execute };
