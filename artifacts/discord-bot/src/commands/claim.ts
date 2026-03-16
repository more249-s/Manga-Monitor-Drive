import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  ChannelType,
} from "discord.js";
import { pool } from "../database/schema.js";

export const data = new SlashCommandBuilder()
  .setName("claim")
  .setDescription("Claim an available chapter")
  .addStringOption((o) =>
    o.setName("project").setDescription("Project name or slug").setRequired(true)
  )
  .addIntegerOption((o) =>
    o.setName("chapter").setDescription("Chapter number").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const input = interaction.options.getString("project", true);
  const chapterNumber = interaction.options.getInteger("chapter", true);

  const { rows: proj } = await pool.query(
    "SELECT * FROM projects WHERE slug = $1 OR LOWER(name) = LOWER($1) OR name ILIKE $2",
    [input, `%${input}%`]
  );

  if (!proj.length) {
    await interaction.editReply(`❌ Project \`${input}\` not found.`);
    return;
  }

  const project = proj[0];

  const { rows: ch } = await pool.query(
    "SELECT * FROM chapters WHERE project_id = $1 AND chapter_number = $2",
    [project.id, chapterNumber]
  );

  if (!ch.length || ch[0].status !== "available") {
    await interaction.editReply(`❌ Chapter **${chapterNumber}** is not available to claim.`);
    return;
  }

  const chapter = ch[0];

  const { rows: mem } = await pool.query("SELECT * FROM members WHERE discord_id = $1", [interaction.user.id]);
  if (!mem.length) {
    await interaction.editReply("❌ You are not a registered team member. Ask an admin to add you with `/member add`.");
    return;
  }

  const member = mem[0];
  const roleNeeded = chapter.role_needed;

  if (roleNeeded === "TL" && member.role !== "TL") {
    await interaction.editReply(`❌ This chapter needs a **Translator (TL)**. Your role is **${member.role}**.`);
    return;
  }
  if (roleNeeded === "ED" && member.role !== "ED") {
    await interaction.editReply(`❌ This chapter needs an **Editor (ED)**. Your role is **${member.role}**.`);
    return;
  }

  const { rows: activeChapters } = await pool.query(
    "SELECT id FROM chapters WHERE claimed_by = $1 AND status IN ('claimed', 'translating', 'editing')",
    [interaction.user.id]
  );

  if (activeChapters.length >= 3) {
    await interaction.editReply("❌ You already have **3 active chapters**. Finish one before claiming another.");
    return;
  }

  await pool.query(
    "UPDATE chapters SET status = 'claimed', claimed_by = $1, started_at = NOW() WHERE id = $2",
    [interaction.user.id, chapter.id]
  );

  if (roleNeeded === "TL") {
    await pool.query("UPDATE projects SET translator_id = $1, current_working = $2 WHERE id = $3", [
      interaction.user.id, chapterNumber, project.id,
    ]);
  } else {
    await pool.query("UPDATE projects SET editor_id = $1 WHERE id = $2", [interaction.user.id, project.id]);
  }

  if (project.channel_id) {
    try {
      const ch2 = await interaction.client.channels.fetch(project.channel_id) as TextChannel;
      const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";
      const roleLabel = roleNeeded === "TL" ? "🌐 Translator" : "✏️ Editor";
      await ch2.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📌 Chapter ${chapterNumber} — Claimed`)
            .setColor("#0099ff")
            .setDescription(`${typeIcon} **${project.name}**\n\n${roleLabel}: <@${interaction.user.id}>`)
            .setTimestamp(),
        ],
      });
    } catch {}
  }

  await interaction.editReply(
    `✅ You claimed **${project.name}** Ch.**${chapterNumber}**! Good luck!\nUse \`/tldone\` or \`/eddone\` when finished.`
  );
}
