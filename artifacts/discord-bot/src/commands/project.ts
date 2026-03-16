import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
} from "discord.js";
import { pool } from "../database/schema.js";
import { updateProjectDashboard, sendLogEvent } from "../services/dashboardService.js";

export const data = new SlashCommandBuilder()
  .setName("project")
  .setDescription("Manage projects")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Create a new project")
      .addStringOption((o) => o.setName("name").setDescription("Project name").setRequired(true))
      .addStringOption((o) => o.setName("source_url").setDescription("Source URL for tracking").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Project type")
          .setRequired(true)
          .addChoices({ name: "🔴 Exclusive", value: "exclusive" }, { name: "🔷 Competitive", value: "competitive" })
      )
      .addNumberOption((o) => o.setName("current_raw").setDescription("Current RAW chapter").setRequired(false))
      .addNumberOption((o) => o.setName("chapter_payment").setDescription("Payment per chapter ($)").setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a project")
      .addStringOption((o) => o.setName("slug").setDescription("Project slug").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("info")
      .setDescription("Get project info")
      .addStringOption((o) => o.setName("slug").setDescription("Project slug").setRequired(true))
  )
  .addSubcommand((s) => s.setName("list").setDescription("List all projects"))
  .addSubcommand((s) =>
    s
      .setName("setsource")
      .setDescription("Add/update a tracking source for a project")
      .addStringOption((o) => o.setName("slug").setDescription("Project slug").setRequired(true))
      .addStringOption((o) => o.setName("source_url").setDescription("New source URL").setRequired(true))
      .addStringOption((o) => o.setName("source_name").setDescription("Source name (optional)").setRequired(false))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    await handleCreate(interaction);
  } else if (sub === "remove") {
    await handleRemove(interaction);
  } else if (sub === "info") {
    await handleInfo(interaction);
  } else if (sub === "list") {
    await handleList(interaction);
  } else if (sub === "setsource") {
    await handleSetSource(interaction);
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const name = interaction.options.getString("name", true);
  const sourceUrl = interaction.options.getString("source_url", true);
  const projectType = interaction.options.getString("type", true);
  const currentRaw = interaction.options.getNumber("current_raw") || 0;
  const chapterPayment = interaction.options.getNumber("chapter_payment") || 6.0;

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);

  const { rows: existing } = await pool.query("SELECT id FROM projects WHERE slug = $1", [slug]);
  if (existing.length) {
    await interaction.editReply(`A project with slug \`${slug}\` already exists.`);
    return;
  }

  let channel: TextChannel | null = null;
  try {
    const guild = interaction.guild!;
    const created = await guild.channels.create({
      name: slug,
      type: ChannelType.GuildText,
      reason: `Project channel for ${name}`,
    });
    channel = created as TextChannel;
  } catch (err) {
    console.error("[Project] Failed to create channel:", err);
  }

  const { rows } = await pool.query(
    `INSERT INTO projects (name, slug, source_site, source_url, project_type, current_raw, chapter_payment, channel_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active') RETURNING id`,
    [name, slug, new URL(sourceUrl).hostname, sourceUrl, projectType, currentRaw, chapterPayment, channel?.id || null]
  );

  const projectId = rows[0].id;

  await pool.query(
    "INSERT INTO tracked_sources (project_id, source_name, source_url, last_chapter) VALUES ($1, $2, $3, $4)",
    [projectId, new URL(sourceUrl).hostname, sourceUrl, currentRaw]
  );

  const typeIcon = projectType === "exclusive" ? "🔴" : "🔷";
  const dashboardEmbed = new EmbedBuilder()
    .setTitle(`📖 ${name}`)
    .setDescription(`${typeIcon} ${projectType === "exclusive" ? "Exclusive" : "Competitive"}`)
    .setColor(projectType === "exclusive" ? "#ff4444" : "#4488ff")
    .addFields(
      { name: "RAW Chapter", value: `${currentRaw || "—"}`, inline: true },
      { name: "Working On", value: "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Translator", value: "None", inline: true },
      { name: "Editor", value: "None", inline: true },
      { name: "Payment/Chapter", value: `$${chapterPayment}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Last updated" });

  let dashboardMsgId: string | null = null;
  if (channel) {
    const pinMsg = await channel.send({ embeds: [dashboardEmbed] });
    await pinMsg.pin().catch(() => {});
    dashboardMsgId = pinMsg.id;
  }

  if (dashboardMsgId) {
    await pool.query("UPDATE projects SET dashboard_message_id = $1 WHERE id = $2", [dashboardMsgId, projectId]);
  }

  await sendLogEvent(interaction.client, interaction.guildId!, "PROJECT_CREATED", `${name} created by ${interaction.user.username}`);

  const replyEmbed = new EmbedBuilder()
    .setTitle("✅ Project Created")
    .setColor("#00cc44")
    .setDescription(`**${name}** has been created!`)
    .addFields(
      { name: "Slug", value: slug, inline: true },
      { name: "Type", value: `${typeIcon} ${projectType}`, inline: true },
      { name: "Channel", value: channel ? `<#${channel.id}>` : "Not created", inline: true },
      { name: "Source", value: sourceUrl, inline: false }
    );

  await interaction.editReply({ embeds: [replyEmbed] });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const slug = interaction.options.getString("slug", true);
  const { rows } = await pool.query("SELECT * FROM projects WHERE slug = $1", [slug]);
  if (!rows.length) {
    await interaction.reply({ content: `No project found with slug \`${slug}\`.`, ephemeral: true });
    return;
  }

  await pool.query("UPDATE projects SET status = 'archived' WHERE slug = $1", [slug]);
  await interaction.reply({ content: `Project **${rows[0].name}** has been archived.`, ephemeral: true });
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const slug = interaction.options.getString("slug", true);
  const { rows } = await pool.query("SELECT * FROM projects WHERE slug = $1", [slug]);
  if (!rows.length) {
    await interaction.reply({ content: `No project found with slug \`${slug}\`.`, ephemeral: true });
    return;
  }

  const p = rows[0];
  const typeIcon = p.project_type === "exclusive" ? "🔴" : "🔷";

  const { rows: srcs } = await pool.query("SELECT * FROM tracked_sources WHERE project_id = $1", [p.id]);

  const embed = new EmbedBuilder()
    .setTitle(`📖 ${p.name}`)
    .setDescription(`${typeIcon} ${p.project_type === "exclusive" ? "Exclusive" : "Competitive"}`)
    .setColor(p.project_type === "exclusive" ? "#ff4444" : "#4488ff")
    .addFields(
      { name: "RAW Chapter", value: `${p.current_raw || "—"}`, inline: true },
      { name: "Working On", value: `${p.current_working || "—"}`, inline: true },
      { name: "Status", value: p.status, inline: true },
      { name: "Payment/Chapter", value: `$${p.chapter_payment}`, inline: true },
      {
        name: "Tracked Sources",
        value: srcs.map((s: any) => `• [${s.source_name}](${s.source_url}) — Last: Ch.${s.last_chapter}`).join("\n") || "None",
        inline: false,
      }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const { rows } = await pool.query("SELECT * FROM projects WHERE status = 'active' ORDER BY name");

  if (!rows.length) {
    await interaction.reply({ content: "No active projects.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("📚 Active Projects")
    .setColor("#0099ff")
    .setDescription(
      rows
        .map((p: any) => {
          const icon = p.project_type === "exclusive" ? "🔴" : "🔷";
          return `${icon} **${p.name}** — RAW: ${p.current_raw || "?"} | Working: ${p.current_working || "—"}`;
        })
        .join("\n")
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleSetSource(interaction: ChatInputCommandInteraction): Promise<void> {
  const slug = interaction.options.getString("slug", true);
  const sourceUrl = interaction.options.getString("source_url", true);
  const sourceName = interaction.options.getString("source_name") || new URL(sourceUrl).hostname;

  const { rows } = await pool.query("SELECT id FROM projects WHERE slug = $1", [slug]);
  if (!rows.length) {
    await interaction.reply({ content: `No project found with slug \`${slug}\`.`, ephemeral: true });
    return;
  }

  const projectId = rows[0].id;

  await pool.query(
    `INSERT INTO tracked_sources (project_id, source_name, source_url, last_chapter)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT DO NOTHING`,
    [projectId, sourceName, sourceUrl]
  );

  await interaction.reply({ content: `Source **${sourceName}** added for project \`${slug}\`.`, ephemeral: true });
}
