import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  TextChannel,
  PermissionFlagsBits,
} from "discord.js";
import { pool } from "../database/schema.js";
import { getMonthlySalary, getTotalSalary } from "../services/salaryService.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View your profile or another member's profile")
  .addUserOption((o) =>
    o.setName("user").setDescription("View a member's profile (Admin: sends to #member-info)").setRequired(false)
  );

function buildProfileEmbed(member: any, target: any, monthlyChapters: number, monthlyEarned: number, totalEarned: number) {
  const roleLabels: Record<string, string> = {
    TL: "Translator (TL)",
    ED: "Editor (ED)",
    TR: "Trainee (TR)",
  };

  const now = new Date();
  const memberSince = member.created_at
    ? new Date(member.created_at).toLocaleDateString("en-US")
    : "Unknown";

  return new EmbedBuilder()
    .setColor("#2b2d31")
    .setAuthor({
      name: `Good day, ${target.username}!`,
      iconURL: target.displayAvatarURL(),
    })
    .setDescription("Here's an overview of your profile information.")
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      {
        name: "📋 Job Role",
        value: roleLabels[member.role] || member.role,
        inline: true,
      },
      {
        name: "💰 Current Balance",
        value: `$${monthlyEarned.toFixed(2)}`,
        inline: true,
      },
      {
        name: "📊 Chapters This Month",
        value: `${monthlyChapters}`,
        inline: true,
      },
      {
        name: "Member since",
        value: memberSince,
        inline: false,
      }
    )
    .setTimestamp();
}

function buildProfileButtons(targetId: string, isAdmin: boolean) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pf_series_${targetId}`)
      .setLabel("Assigned Series")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📚"),
    new ButtonBuilder()
      .setCustomId(`pf_email_${targetId}`)
      .setLabel("Active Email")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📧"),
    new ButtonBuilder()
      .setCustomId(`pf_payment_${targetId}`)
      .setLabel("Payment Method")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💰")
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pf_finance_${targetId}`)
      .setLabel("Finance Details")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📈"),
    new ButtonBuilder()
      .setCustomId(`pf_pending_${targetId}`)
      .setLabel("Pending Chapters")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📝")
  );

  return [row1, row2];
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user");
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;

  const target = targetUser || interaction.user;
  const isViewingOther = targetUser && targetUser.id !== interaction.user.id;

  if (isViewingOther && !isAdmin) {
    await interaction.reply({ content: "❌ Only admins can view other members' profiles.", ephemeral: true });
    return;
  }

  const { rows: mem } = await pool.query("SELECT * FROM members WHERE discord_id = $1", [target.id]);

  if (!mem.length) {
    const notFoundMsg = isViewingOther
      ? `❌ <@${target.id}> is not a registered team member.`
      : "❌ You are not registered. Ask an admin to add you with `/member add`.";
    await interaction.reply({ content: notFoundMsg, ephemeral: true });
    return;
  }

  const member = mem[0];
  const monthly = await getMonthlySalary(target.id);
  const totalEarned = await getTotalSalary(target.id);
  const monthlyEarned = monthly.reduce((s, r) => s + r.amount, 0);
  const monthlyChapters = monthly.reduce((s, r) => s + r.chapters, 0);

  const embed = buildProfileEmbed(member, target, monthlyChapters, monthlyEarned, totalEarned);
  const components = buildProfileButtons(target.id, isAdmin);

  if (isViewingOther && isAdmin) {
    const guild = interaction.guild!;
    let memberInfoChannel = guild.channels.cache.find(
      (c) => c.name === "member-info" && c.isTextBased()
    ) as TextChannel | undefined;

    if (!memberInfoChannel) {
      memberInfoChannel = (await guild.channels.create({
        name: "member-info",
        type: 0,
        reason: "Auto-created for member profile info",
      })) as TextChannel;
    }

    await memberInfoChannel.send({
      content: `📋 Profile for <@${target.id}> — requested by <@${interaction.user.id}>`,
      embeds: [embed],
      components,
    });

    await interaction.reply({
      content: `✅ Profile sent to <#${memberInfoChannel.id}>.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  }
}

export async function handleProfileButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const targetId = parts[2];

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (interaction.user.id !== targetId && !isAdmin) {
    await interaction.reply({ content: "❌ This is not your profile.", ephemeral: true });
    return;
  }

  const { rows: mem } = await pool.query("SELECT * FROM members WHERE discord_id = $1", [targetId]);
  if (!mem.length) {
    await interaction.reply({ content: "❌ Member not found.", ephemeral: true });
    return;
  }

  const member = mem[0];

  if (action === "series") {
    const { rows: projects } = await pool.query(
      `SELECT DISTINCT p.name, p.project_type
       FROM projects p
       LEFT JOIN chapters c ON c.project_id = p.id AND c.claimed_by = $1
       WHERE p.translator_id = $1 OR p.editor_id = $1 OR c.claimed_by = $1`,
      [targetId]
    );

    const list = projects.length
      ? projects.map((p: any) => `${p.project_type === "exclusive" ? "🔴" : "🔷"} ${p.name}`).join("\n")
      : "No assigned series.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📚 Assigned Series")
          .setDescription(list)
          .setColor("#5865f2"),
      ],
      ephemeral: true,
    });
  } else if (action === "email") {
    const email = member.payment_info?.startsWith("email:") ? member.payment_info.replace("email:", "") : "Not set";
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📧 Contact Email")
          .setDescription(`\`${email}\`\n\nUpdate with \`/setemail\``)
          .setColor("#57f287"),
      ],
      ephemeral: true,
    });
  } else if (action === "payment") {
    const method = member.payment_method || "Not set";
    const info = interaction.user.id === targetId || isAdmin
      ? (member.payment_info || "Not set")
      : "🔒 Hidden";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("💰 Payment Method")
          .addFields(
            { name: "Method", value: method, inline: true },
            { name: "Info", value: info, inline: true }
          )
          .setDescription("Update with `/setpayment`")
          .setColor("#fee75c"),
      ],
      ephemeral: true,
    });
  } else if (action === "finance") {
    const monthly = await getMonthlySalary(targetId);
    const total = await getTotalSalary(targetId);
    const monthTotal = monthly.reduce((s, r) => s + r.amount, 0);
    const monthChaps = monthly.reduce((s, r) => s + r.chapters, 0);

    const { rows: unpaid } = await pool.query(
      "SELECT SUM(amount) as total FROM salary_records WHERE discord_id = $1 AND paid = false",
      [targetId]
    );

    const embed = new EmbedBuilder()
      .setTitle("📈 Finance Details")
      .setColor("#57f287")
      .addFields(
        { name: "This Month", value: `$${monthTotal.toFixed(2)} (${monthChaps} ch.)`, inline: true },
        { name: "Total Earned", value: `$${total.toFixed(2)}`, inline: true },
        { name: "Unpaid Balance", value: `$${parseFloat(unpaid[0]?.total || "0").toFixed(2)}`, inline: true }
      );

    if (monthly.length) {
      embed.addFields({
        name: "Breakdown",
        value: monthly.map((r) => `• ${r.projectName}: ${r.chapters} ch. — $${r.amount.toFixed(2)}`).join("\n"),
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else if (action === "pending") {
    const { rows: pending } = await pool.query(
      `SELECT c.chapter_number, c.status, p.name as project_name
       FROM chapters c JOIN projects p ON c.project_id = p.id
       WHERE c.claimed_by = $1 AND c.status NOT IN ('completed', 'available')
       ORDER BY c.started_at DESC`,
      [targetId]
    );

    const statusEmoji: Record<string, string> = {
      claimed: "🔵",
      translating: "🟠",
      editing: "🟣",
    };

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📝 Pending Chapters")
          .setDescription(
            pending.length
              ? pending.map((c: any) => `${statusEmoji[c.status] || "⚪"} **${c.project_name}** Ch.**${c.chapter_number}** — ${c.status}`).join("\n")
              : "No pending chapters!"
          )
          .setColor("#5865f2"),
      ],
      ephemeral: true,
    });
  }
}
