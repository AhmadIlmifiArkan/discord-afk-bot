require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Masuk ke voice channel kamu"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Keluar dari voice channel"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Melihat status bot di voice channel"),

  new SlashCommandBuilder()
    .setName("testdisconnect")
    .setDescription("Menguji command disconnect"),
].map((command) => command.toJSON());

const rest = new REST({
  version: "10",
}).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Mendaftarkan GUILD slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      {
        body: commands,
      },
    );

    console.log("=================================");
    console.log("GUILD COMMAND BERHASIL DIDAFTARKAN");
    console.log("Guild:", process.env.GUILD_ID);
    console.log("=================================");
  } catch (error) {
    console.error("Gagal mendaftarkan command:");
    console.error(error);
  }
})();
