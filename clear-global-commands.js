require("dotenv").config();

const { REST, Routes } = require("discord.js");

const rest = new REST({
  version: "10",
}).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Menghapus global slash commands...");

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: [],
    });

    console.log("=================================");
    console.log("GLOBAL COMMANDS BERHASIL DIHAPUS");
    console.log("=================================");
  } catch (error) {
    console.error("Gagal menghapus global commands:");
    console.error(error);
  }
})();
