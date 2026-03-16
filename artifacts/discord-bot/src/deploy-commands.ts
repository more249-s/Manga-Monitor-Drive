import { REST, Routes } from "discord.js";
import { CONFIG } from "./utils/config.js";

import * as projectCmd from "./commands/project.js";
import * as chapterCmd from "./commands/chapter.js";
import * as memberCmd from "./commands/member.js";
import * as profileCmd from "./commands/profile.js";
import * as salaryCmd from "./commands/salary.js";
import * as statsCmd from "./commands/stats.js";

const commands = [
  projectCmd.data.toJSON(),
  chapterCmd.data.toJSON(),
  memberCmd.data.toJSON(),
  profileCmd.data.toJSON(),
  salaryCmd.data.toJSON(),
  statsCmd.data.toJSON(),
];

const rest = new REST().setToken(CONFIG.DISCORD_BOT_TOKEN);

async function deploy() {
  try {
    console.log("[Deploy] Registering slash commands...");

    const guildId = CONFIG.DISCORD_GUILD_ID;
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(CONFIG.DISCORD_CLIENT_ID, guildId), {
        body: commands,
      });
      console.log("[Deploy] Commands registered to guild:", guildId);
    } else {
      await rest.put(Routes.applicationCommands(CONFIG.DISCORD_CLIENT_ID), { body: commands });
      console.log("[Deploy] Commands registered globally");
    }
  } catch (err) {
    console.error("[Deploy] Error:", err);
  }
}

deploy();
