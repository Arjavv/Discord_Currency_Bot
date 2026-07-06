const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const commands = [];
const commandsPath = path.join(__dirname, "src", "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log("Loaded: " + command.data.name);
  }
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Registering " + commands.length + " commands...");
    if (guildId && guildId.trim() && guildId !== "your_testing_guild_id_here") {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log("Done - guild commands updated instantly for guild " + guildId);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("Done - global commands updated (may take up to 1h to propagate)");
    }
    commands.forEach(c => {
      const subs = (c.options || []).filter(o => o.type === 1).map(o => o.name);
      console.log("/" + c.name + (subs.length ? ": " + subs.join(", ") : ""));
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
})();
