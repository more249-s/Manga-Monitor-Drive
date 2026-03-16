import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  PermissionFlagsBits,
} from "discord.js";
import { pool } from "../database/schema.js";
import { recordSalary } from "../services/salaryService.js";
import { updateProjectDashboard, sendLogEvent } from "../services/dashboardService.js";
import { getChapterImages } from "../scrapers/scraperManager.js";
import { downloadAndUploadChapter } from "../services/driveService.js";

export const data = new SlashCommandBuilder()
  .setName("chapter")
  .setDescription("Manage chapters")
  .addSubcommand((s) =>
    s
      .setName("open")
      .setDescription("Open a chapter for claiming")
      .addStringOption((o) => o.setName("project").setDescription("Project slug").setRequired(true))
      .addIntegerOption((o) => o.setName("number").setDescription("Chapter number").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("role")
          .setDescription("Role needed")
          .setRequired(true)
          .addChoices({ name: "Translator (TL)", value: "TL" }, { name: "Editor (ED)", value: "ED" })
      )
      .addStringOption((o) => o.setName("raw_url").setDescription("RAW chapter URL").setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName("start")
      .setDescription("Mark chapter as in progress")
      .addStringOption((o) => o.setName("project").setDescription("Project slug").setRequired(true))
      .addIntegerOption((o) => o.setName("number").setDescription("Chapter number").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("finish")
      .setDescription("Mark chapter as completed")
      .addStringOption((o) => o.setName("project").setDescription("Project slug").setRequired(true))
      .addIntegerOption((o) => o.setName("number").setDescription("Chapter number").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("status")
      .setDescription("Check chapter status")
      .addStringOption((o) => o.setName("project").setDescription("Project slug").setRequired(true))
      .addIntegerOption((o) => o.setName("number").setDescription("Chapter number").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("download")
      .setDescription("Download RAW and upload to Google Drive")
      .addStringOption((o) => o.setName("project").setDescription("Project slug").setRequired(true))
      .addIntegerOption((o) => o.setName("number").setDescription("Chapter number").setRequired(true))
      .addStringOption((o) => o.setName("raw_url").setDescription("RAW chapter URL").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "open") await handleOpen(interaction);
  else if (sub === "start") await handleStart(interaction);
  else if (sub === "finish") await handleFinish(interaction);
  else if (sub === "status") await handleStatus(interaction);
  else if (sub === "download") await handleDownload(interaction);
}

async function handleOpen(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "Only admins can open chapters.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("number", true);
  const roleNeeded = interaction.options.getString("role", true);
  const rawUrl = interaction.options.getString("raw_url") || null;

  const { rows: projectRows } = await pool.query("SELECT * FROM projects WHERE slug = $1", [projectSlug]);
  if (!projectRows.length) {
    await interaction.editReply(`No project found: \`${projectSlug}\``);
    return;
  }

  const project = projectRows[0];

  await pool.query(
    `INSERT INTO chapters (project_id, chapter_number, status, role_needed, raw_url)
     VALUES ($1, $2, 'available', $3, $4)
     ON CONFLICT (project_id, chapter_number) DO UPDATE SET status = 'available', role_needed = $3, raw_url = $4`,
    [project.id, chapterNumber, roleNeeded, rawUrl]
  );

  const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";
  const roleName = roleNeeded === "TL" ? "Translator" : "Editor";

  const { rows: activeMembers } = await pool.query(
    `SELECT m.discord_id, m.username
     FROM members m
     LEFT JOIN chapters c ON c.claimed_by = m.discord_id AND c.status IN ('claimed', 'translating', 'editing')
     WHERE m.role = $1
     GROUP BY m.discord_id, m.username
     ORDER BY COUNT(c.id) ASC
     LIMIT 1`,
    [roleNeeded]
  );

  const suggestionText =
    activeMembers.length > 0 ? `\n💡 Suggested: <@${activeMembers[0].discord_id}>` : "";

  const claimEmbed = new EmbedBuilder()
    .setTitle("📢 Chapter Available")
    .setColor("#ffaa00")
    .addFields(
      { name: "Work", value: `${typeIcon} ${project.name}`, inline: true },
      { name: "Chapter", value: `${chapterNumber}`, inline: true },
      { name: "Role Needed", value: roleName, inline: true }
    )
    .setDescription(rawUrl ? `RAW: ${rawUrl}${suggestionText}` : suggestionText || null)
    .setTimestamp();

  const claimButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${project.id}_${chapterNumber}`)
      .setLabel("Claim Chapter")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✋")
  );

  const guild = interaction.guild!;
  let targetChannel = guild.channels.cache.find(
    (c) => c.name === "available-chapters" && c.isTextBased()
  ) as TextChannel | undefined;

  if (!targetChannel) {
    targetChannel = (await guild.channels.create({
      name: "available-chapters",
      type: 0,
    })) as TextChannel;
  }

  const claimMsg = await targetChannel.send({ embeds: [claimEmbed], components: [claimButton] });

  await pool.query(
    "UPDATE chapters SET claim_message_id = $1, claim_channel_id = $2 WHERE project_id = $3 AND chapter_number = $4",
    [claimMsg.id, targetChannel.id, project.id, chapterNumber]
  );

  await sendLogEvent(interaction.client, interaction.guildId!, "CHAPTER_OPENED", `Chapter ${chapterNumber} of ${project.name} opened for ${roleName}`);
  await interaction.editReply({ content: `Chapter **${chapterNumber}** of **${project.name}** is now open in <#${targetChannel.id}>!` });
}

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("number", true);

  const { rows: proj } = await pool.query("SELECT * FROM projects WHERE slug = $1", [projectSlug]);
  if (!proj.length) {
    await interaction.reply({ content: `Project \`${projectSlug}\` not found.`, ephemeral: true });
    return;
  }

  const { rows: ch } = await pool.query(
    "SELECT * FROM chapters WHERE project_id = $1 AND chapter_number = $2",
    [proj[0].id, chapterNumber]
  );

  if (!ch.length) {
    await interaction.reply({ content: "Chapter not found.", ephemeral: true });
    return;
  }

  if (ch[0].claimed_by !== interaction.user.id) {
    await interaction.reply({ content: "You didn't claim this chapter.", ephemeral: true });
    return;
  }

  const newStatus = ch[0].role_needed === "TL" ? "translating" : "editing";
  await pool.query("UPDATE chapters SET status = $1 WHERE id = $2", [newStatus, ch[0].id]);
  await interaction.reply({ content: `Chapter **${chapterNumber}** of **${proj[0].name}** is now **${newStatus}**.` });
}

async function handleFinish(interaction: ChatInputCommandInteraction): Promise<void> {
  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("number", true);

  await interaction.deferReply();

  const { rows: proj } = await pool.query("SELECT * FROM projects WHERE slug = $1", [projectSlug]);
  if (!proj.length) {
    await interaction.editReply(`Project \`${projectSlug}\` not found.`);
    return;
  }

  const project = proj[0];

  const { rows: ch } = await pool.query(
    "SELECT * FROM chapters WHERE project_id = $1 AND chapter_number = $2",
    [project.id, chapterNumber]
  );

  if (!ch.length) {
    await interaction.editReply("Chapter not found.");
    return;
  }

  const chapter = ch[0];

  if (chapter.claimed_by !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.editReply("You didn't claim this chapter.");
    return;
  }

  await pool.query("UPDATE chapters SET status = 'completed', completed_at = NOW() WHERE id = $1", [chapter.id]);
  await pool.query(
    "UPDATE members SET total_chapters = total_chapters + 1 WHERE discord_id = $1",
    [chapter.claimed_by]
  );

  await recordSalary(chapter.claimed_by, project.id, chapter.id, chapter.role_needed, parseFloat(project.chapter_payment));

  await sendLogEvent(interaction.client, interaction.guildId!, "CHAPTER_COMPLETED", `Chapter ${chapterNumber} of ${project.name} completed by ${interaction.user.username}`);
  await updateProjectDashboard(interaction.client, project.id);

  const timeTaken = chapter.started_at
    ? `${Math.round((Date.now() - new Date(chapter.started_at).getTime()) / 3600000)}h`
    : "—";

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("✅ Chapter Completed!")
        .setColor("#00cc44")
        .addFields(
          { name: "Project", value: project.name, inline: true },
          { name: "Chapter", value: `${chapterNumber}`, inline: true },
          { name: "Time Taken", value: timeTaken, inline: true },
          { name: "Earned", value: `$${project.chapter_payment}`, inline: true }
        )
        .setTimestamp(),
    ],
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("number", true);

  const { rows: proj } = await pool.query("SELECT * FROM projects WHERE slug = $1", [projectSlug]);
  if (!proj.length) {
    await interaction.reply({ content: `Project \`${projectSlug}\` not found.`, ephemeral: true });
    return;
  }

  const { rows: ch } = await pool.query(
    "SELECT c.*, m.username FROM chapters c LEFT JOIN members m ON c.claimed_by = m.discord_id WHERE c.project_id = $1 AND c.chapter_number = $2",
    [proj[0].id, chapterNumber]
  );

  if (!ch.length) {
    await interaction.reply({ content: "Chapter not found.", ephemeral: true });
    return;
  }

  const chapter = ch[0];
  const statusEmoji: Record<string, string> = {
    available: "🟡",
    claimed: "🔵",
    translating: "🟠",
    editing: "🟣",
    completed: "🟢",
  };

  const embed = new EmbedBuilder()
    .setTitle(`Chapter ${chapterNumber} — ${proj[0].name}`)
    .setColor("#0099ff")
    .addFields(
      { name: "Status", value: `${statusEmoji[chapter.status] || "⚪"} ${chapter.status}`, inline: true },
      { name: "Claimed By", value: chapter.username || "—", inline: true },
      { name: "Role", value: chapter.role_needed, inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleDownload(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "Only admins can trigger downloads.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const projectSlug = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("number", true);
  const rawUrl = interaction.options.getString("raw_url", true);

  const { rows: proj } = await pool.query("SELECT * FROM projects WHERE slug = $1", [projectSlug]);
  if (!proj.length) {
    await interaction.editReply(`Project \`${projectSlug}\` not found.`);
    return;
  }

  await interaction.editReply(`⏳ Downloading RAW images for **${proj[0].name}** Chapter **${chapterNumber}**...`);

  const images = await getChapterImages(rawUrl);

  if (!images.length) {
    await interaction.editReply("Could not extract images from that URL. The chapter may be locked or the site is protected.");
    return;
  }

  const driveLink = await downloadAndUploadChapter(proj[0].name, chapterNumber, images);

  if (driveLink) {
    await pool.query(
      "UPDATE chapters SET drive_url = $1 WHERE project_id = $2 AND chapter_number = $3",
      [driveLink, proj[0].id, chapterNumber]
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📥 RAW Uploaded!")
          .setColor("#00cc44")
          .addFields(
            { name: "Project", value: proj[0].name, inline: true },
            { name: "Chapter", value: `${chapterNumber}`, inline: true },
            { name: "Images", value: `${images.length} pages`, inline: true },
            { name: "Drive Link", value: driveLink }
          )
          .setTimestamp(),
      ],
    });
  } else {
    await interaction.editReply("Failed to upload to Google Drive. Check the service account permissions.");
  }
}
