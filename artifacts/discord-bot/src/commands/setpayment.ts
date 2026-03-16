import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("setpayment")
  .setDescription("Set your payment method and info (PayPal, Crypto, Bank, etc.)")
  .addStringOption((o) =>
    o
      .setName("method")
      .setDescription("Payment method")
      .setRequired(true)
      .addChoices(
        { name: "PayPal", value: "PayPal" },
        { name: "Binance Pay", value: "Binance Pay" },
        { name: "USDT (Crypto)", value: "USDT" },
        { name: "Bank Transfer", value: "Bank Transfer" },
        { name: "Wise", value: "Wise" },
        { name: "Other", value: "Other" }
      )
  )
  .addStringOption((o) =>
    o.setName("info").setDescription("Your payment address/email/ID").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const method = interaction.options.getString("method", true);
  const info = interaction.options.getString("info", true);

  await pool.query(
    "UPDATE members SET payment_method = $1, payment_info = $2 WHERE discord_id = $3",
    [method, info, interaction.user.id]
  );

  await interaction.reply({
    content: `✅ Payment method set to **${method}**: \`${info}\`\nOnly admins can see your payment details.`,
    ephemeral: true,
  });
}
