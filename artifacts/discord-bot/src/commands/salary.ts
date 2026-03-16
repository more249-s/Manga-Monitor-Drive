import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { pool } from "../database/schema.js";
import { getMonthlySalary, getTeamSalaryReport, markAsPaid } from "../services/salaryService.js";
import { attached_assets } from "../utils/paymentList.js";

export const data = new SlashCommandBuilder()
  .setName("salary")
  .setDescription("Salary management")
  .addSubcommand((s) =>
    s
      .setName("view")
      .setDescription("View salary for a user")
      .addUserOption((o) => o.setName("user").setDescription("User (default: yourself)").setRequired(false))
      .addIntegerOption((o) => o.setName("month").setDescription("Month (1-12)").setRequired(false))
      .addIntegerOption((o) => o.setName("year").setDescription("Year").setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName("report")
      .setDescription("Full team salary report")
      .addIntegerOption((o) => o.setName("month").setDescription("Month (1-12)").setRequired(false))
      .addIntegerOption((o) => o.setName("year").setDescription("Year").setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName("markpaid")
      .setDescription("Mark a user salary as paid")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((o) => o.setName("month").setDescription("Month").setRequired(false))
      .addIntegerOption((o) => o.setName("year").setDescription("Year").setRequired(false))
  )
  .addSubcommand((s) => s.setName("paymentlist").setDescription("View/update the master payment list"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "view") {
    const target = interaction.options.getUser("user") || interaction.user;
    const month = interaction.options.getInteger("month") || undefined;
    const year = interaction.options.getInteger("year") || undefined;

    const records = await getMonthlySalary(target.id, month, year);

    const now = new Date();
    const m = month || now.getMonth() + 1;
    const y = year || now.getFullYear();

    const total = records.reduce((sum, r) => sum + r.amount, 0);

    const embed = new EmbedBuilder()
      .setTitle(`💰 Salary — ${target.username}`)
      .setDescription(`Month: **${m}/${y}**`)
      .setColor("#ffcc00")
      .addFields(
        ...records.map((r) => ({
          name: r.projectName,
          value: `${r.chapters} chapters — $${r.amount.toFixed(2)}`,
          inline: true,
        })),
        { name: "TOTAL", value: `**$${total.toFixed(2)}**`, inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else if (sub === "report") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Admins only.", ephemeral: true });
      return;
    }

    const month = interaction.options.getInteger("month") || undefined;
    const year = interaction.options.getInteger("year") || undefined;
    const now = new Date();
    const m = month || now.getMonth() + 1;
    const y = year || now.getFullYear();

    const report = await getTeamSalaryReport(m, y);

    if (!report.length) {
      await interaction.reply({ content: `No salary data for ${m}/${y}.`, ephemeral: true });
      return;
    }

    const totalPayout = report.reduce((sum, r) => sum + r.total, 0);

    const embed = new EmbedBuilder()
      .setTitle(`📊 Team Salary Report — ${m}/${y}`)
      .setColor("#ffcc00")
      .setDescription(
        report
          .map((r) => `${r.paid ? "✅" : "⏳"} <@${r.discordId}> — **$${r.total.toFixed(2)}**`)
          .join("\n")
      )
      .addFields({ name: "Total Payout", value: `**$${totalPayout.toFixed(2)}**`, inline: false })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else if (sub === "markpaid") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Admins only.", ephemeral: true });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const month = interaction.options.getInteger("month") || new Date().getMonth() + 1;
    const year = interaction.options.getInteger("year") || new Date().getFullYear();

    await markAsPaid(user.id, month, year);
    await interaction.reply({ content: `✅ Salary for <@${user.id}> marked as paid for ${month}/${year}.` });
  } else if (sub === "paymentlist") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Admins only.", ephemeral: true });
      return;
    }

    const { rows: projects } = await pool.query(
      "SELECT name, chapter_payment FROM projects WHERE status = 'active' ORDER BY name"
    );

    const embed = new EmbedBuilder()
      .setTitle("💵 Payment List — All Works")
      .setColor("#ffaa00")
      .setDescription(
        projects.map((p: any) => `**${p.name}** — $${p.chapter_payment}/chapter`).join("\n") || "No projects."
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}
