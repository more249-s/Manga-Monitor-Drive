import {
  Client,
  TextChannel,
  EmbedBuilder,
  ColorResolvable,
} from "discord.js";
import { pool } from "../database/schema.js";

export async function updateProjectDashboard(client: Client, projectId: number): Promise<void> {
  const { rows } = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  const project = rows[0];
  if (!project || !project.channel_id || !project.dashboard_message_id) return;

  try {
    const channel = await client.channels.fetch(project.channel_id) as TextChannel;
    if (!channel) return;

    const typeIcon = project.project_type === "exclusive" ? "🔴" : "🔷";
    const color: ColorResolvable = project.project_type === "exclusive" ? "#ff4444" : "#4488ff";

    let translatorName = "None";
    let editorName = "None";

    if (project.translator_id) {
      try {
        const member = await channel.guild.members.fetch(project.translator_id);
        translatorName = member.displayName;
      } catch {}
    }

    if (project.editor_id) {
      try {
        const member = await channel.guild.members.fetch(project.editor_id);
        editorName = member.displayName;
      } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle(`📖 ${project.name}`)
      .setDescription(`${typeIcon} ${project.project_type === "exclusive" ? "Exclusive" : "Competitive"}`)
      .setColor(color)
      .addFields(
        { name: "RAW Chapter", value: `${project.current_raw || "—"}`, inline: true },
        { name: "Working On", value: `${project.current_working || "—"}`, inline: true },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "Translator", value: translatorName, inline: true },
        { name: "Editor", value: editorName, inline: true },
        { name: "Status", value: project.status || "active", inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Last updated" });

    const msg = await channel.messages.fetch(project.dashboard_message_id);
    await msg.edit({ embeds: [embed] });
  } catch (err) {
    console.error("[Dashboard] Update error:", err);
  }
}

export async function sendLogEvent(
  client: Client,
  guildId: string,
  eventType: string,
  details: string
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const logChannel = guild.channels.cache.find(
      (c) => c.name === "chapter-log" && c.isTextBased()
    ) as TextChannel | undefined;

    if (!logChannel) return;

    const icons: Record<string, string> = {
      CHAPTER_CLAIMED: "📌",
      CHAPTER_COMPLETED: "✅",
      RAW_DETECTED: "🚨",
      PROJECT_CREATED: "📁",
      CHAPTER_OPENED: "📢",
      MEMBER_ADDED: "👤",
    };

    const icon = icons[eventType] || "📋";
    await logChannel.send(`${icon} **${eventType}** — ${details}`);
  } catch {}
}
