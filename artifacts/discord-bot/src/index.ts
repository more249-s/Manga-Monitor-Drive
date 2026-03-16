import {
  Client,
  GatewayIntentBits,
  Collection,
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import { CONFIG } from "./utils/config.js";
import { initDatabase } from "./database/schema.js";
import { startRawTracker } from "./events/rawTracker.js";
import { handleClaimButton } from "./buttons/claimButton.js";

import * as projectCmd from "./commands/project.js";
import * as chapterCmd from "./commands/chapter.js";
import * as memberCmd from "./commands/member.js";
import * as profileCmd from "./commands/profile.js";
import * as salaryCmd from "./commands/salary.js";
import * as statsCmd from "./commands/stats.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const commands = new Collection<string, { data: any; execute: (i: ChatInputCommandInteraction) => Promise<void> }>();
commands.set("project", projectCmd);
commands.set("chapter", chapterCmd);
commands.set("member", memberCmd);
commands.set("profile", profileCmd);
commands.set("salary", salaryCmd);
commands.set("stats", statsCmd);

client.once("ready", async () => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`);
  console.log(`[Bot] Serving ${client.guilds.cache.size} server(s)`);

  await initDatabase();

  await deployCommands();

  startRawTracker(client);
});

async function deployCommands() {
  const { REST, Routes } = await import("discord.js");
  const rest = new REST().setToken(CONFIG.DISCORD_BOT_TOKEN);

  const cmdData = Array.from(commands.values()).map((c) => c.data.toJSON());

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(CONFIG.DISCORD_CLIENT_ID, guild.id), {
        body: cmdData,
      });
      console.log(`[Bot] Commands registered in: ${guild.name}`);
    } catch (err) {
      console.error(`[Bot] Failed to register commands in ${guild.name}:`, err);
    }
  }
}

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[Bot] Command error (${interaction.commandName}):`, err);
      const errorMsg = { content: "An error occurred. Please try again.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg).catch(() => {});
      } else {
        await interaction.reply(errorMsg).catch(() => {});
      }
    }
  }

  if (interaction.isButton()) {
    const buttonInteraction = interaction as ButtonInteraction;

    if (buttonInteraction.customId.startsWith("claim_")) {
      await handleClaimButton(buttonInteraction).catch((err) => {
        console.error("[Bot] Button error:", err);
      });
    }
  }
});

client.on("error", (err) => {
  console.error("[Bot] Client error:", err);
});

client.login(CONFIG.DISCORD_BOT_TOKEN).catch((err) => {
  console.error("[Bot] Login failed:", err);
  process.exit(1);
});
