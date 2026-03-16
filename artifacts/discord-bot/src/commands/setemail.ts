import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("setemail")
  .setDescription("Set your contact email for the team")
  .addStringOption((o) =>
    o.setName("email").setDescription("Your email address").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const email = interaction.options.getString("email", true);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await interaction.reply({ content: "❌ Invalid email format.", ephemeral: true });
    return;
  }

  const { rows: member } = await pool.query("SELECT * FROM members WHERE discord_id = $1", [interaction.user.id]);
  if (!member.length) {
    await interaction.reply({ content: "❌ You are not registered. Ask an admin to add you with `/member add`.", ephemeral: true });
    return;
  }

  await pool.query(
    "UPDATE members SET payment_info = $1 WHERE discord_id = $2",
    [`email:${email}`, interaction.user.id]
  );

  await interaction.reply({
    content: `✅ Email set to \`${email}\``,
    ephemeral: true,
  });
}
