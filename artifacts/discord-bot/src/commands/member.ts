import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("member")
  .setDescription("Manage team members")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add a team member")
      .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("role")
          .setDescription("Team role")
          .setRequired(true)
          .addChoices(
            { name: "Translator (TL)", value: "TL" },
            { name: "Editor (ED)", value: "ED" },
            { name: "Trainee (TR)", value: "TR" }
          )
      )
      .addNumberOption((o) => o.setName("rate").setDescription("Pay rate per chapter ($)").setRequired(false))
      .addStringOption((o) => o.setName("payment_method").setDescription("Payment method").setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a team member")
      .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("setrate")
      .setDescription("Set chapter pay rate")
      .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true))
      .addNumberOption((o) => o.setName("rate").setDescription("Pay rate ($)").setRequired(true))
  )
  .addSubcommand((s) => s.setName("list").setDescription("List all members"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && sub !== "list") {
    await interaction.reply({ content: "Only admins can manage members.", ephemeral: true });
    return;
  }

  if (sub === "add") {
    const user = interaction.options.getUser("user", true);
    const role = interaction.options.getString("role", true);
    const rate = interaction.options.getNumber("rate") || 0.5;
    const paymentMethod = interaction.options.getString("payment_method") || null;

    await pool.query(
      `INSERT INTO members (discord_id, username, role, chapter_rate, payment_method)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discord_id) DO UPDATE SET role = $3, chapter_rate = $4`,
      [user.id, user.username, role, rate, paymentMethod]
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Member Added")
          .setColor("#00cc44")
          .addFields(
            { name: "User", value: `<@${user.id}>`, inline: true },
            { name: "Role", value: role, inline: true },
            { name: "Rate", value: `$${rate}/chapter`, inline: true }
          ),
      ],
    });
  } else if (sub === "remove") {
    const user = interaction.options.getUser("user", true);
    await pool.query("DELETE FROM members WHERE discord_id = $1", [user.id]);
    await interaction.reply({ content: `<@${user.id}> has been removed from the team.` });
  } else if (sub === "setrate") {
    const user = interaction.options.getUser("user", true);
    const rate = interaction.options.getNumber("rate", true);
    await pool.query("UPDATE members SET chapter_rate = $1 WHERE discord_id = $2", [rate, user.id]);
    await interaction.reply({ content: `Rate for <@${user.id}> set to **$${rate}/chapter**.` });
  } else if (sub === "list") {
    const { rows } = await pool.query("SELECT * FROM members ORDER BY role, username");

    if (!rows.length) {
      await interaction.reply({ content: "No members registered yet.", ephemeral: true });
      return;
    }

    const tls = rows.filter((m: any) => m.role === "TL");
    const eds = rows.filter((m: any) => m.role === "ED");
    const trs = rows.filter((m: any) => m.role === "TR");

    const fmt = (list: any[]) =>
      list.map((m: any) => `<@${m.discord_id}> — $${m.chapter_rate}/ch (${m.total_chapters} total)`).join("\n") || "None";

    const embed = new EmbedBuilder()
      .setTitle("👥 Team Members")
      .setColor("#0099ff")
      .addFields(
        { name: "🌐 Translators (TL)", value: fmt(tls), inline: false },
        { name: "✏️ Editors (ED)", value: fmt(eds), inline: false },
        { name: "🎓 Trainees (TR)", value: fmt(trs), inline: false }
      );

    await interaction.reply({ embeds: [embed] });
  }
}
