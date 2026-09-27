require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { Client, GatewayIntentBits, Events } = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// ==================================================
// AFK STORAGE
// ==================================================

const AFK_FILE = path.join(__dirname, "afk-channels.json");

// Menyimpan data AFK
const afkChannels = new Map();

// ==================================================
// LOAD AFK DATA
// ==================================================

function loadAfkChannels() {
  try {
    if (!fs.existsSync(AFK_FILE)) {
      fs.writeFileSync(AFK_FILE, JSON.stringify({}, null, 2));

      console.log("📁 AFK storage created.");

      return;
    }

    const data = fs.readFileSync(AFK_FILE, "utf8");

    const parsedData = JSON.parse(data);

    for (const [guildId, channelId] of Object.entries(parsedData)) {
      afkChannels.set(guildId, channelId);
    }

    console.log(`📁 Loaded ${afkChannels.size} AFK channel(s).`);
  } catch (error) {
    console.error("❌ Failed to load AFK data:", error);
  }
}

// ==================================================
// SAVE AFK DATA
// ==================================================

function saveAfkChannels() {
  try {
    const data = Object.fromEntries(afkChannels);

    fs.writeFileSync(AFK_FILE, JSON.stringify(data, null, 2));

    console.log("💾 AFK data saved.");
  } catch (error) {
    console.error("❌ Failed to save AFK data:", error);
  }
}

// ==================================================
// TRACKING
// ==================================================

// Guild yang memang sengaja melakukan /leave
const manualDisconnects = new Set();

// Mencegah reconnect dijalankan berkali-kali
const reconnectingGuilds = new Set();

// ==================================================
// MEMBUAT VOICE CONNECTION
// ==================================================

function createVoiceConnection(guild, channel) {
  const guildId = guild.id;

  console.log(`🎧 Creating voice connection to ${channel.name} (${guildId})`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });

  // ==============================================
  // CONNECTION READY
  // ==============================================

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log(`✅ Voice connection READY | Guild ${guildId}`);

    reconnectingGuilds.delete(guildId);
  });

  // ==============================================
  // CONNECTION DISCONNECTED
  // ==============================================

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.log(`⚠️ Voice connection DISCONNECTED | Guild ${guildId}`);

    // ------------------------------------------
    // Jika disconnect karena /leave
    // ------------------------------------------

    if (manualDisconnects.has(guildId)) {
      console.log(`ℹ️ Disconnect was intentional | Guild ${guildId}`);

      return;
    }

    // ------------------------------------------
    // Jika reconnect sedang berjalan
    // ------------------------------------------

    if (reconnectingGuilds.has(guildId)) {
      console.log(`ℹ️ Reconnect is already in progress | Guild ${guildId}`);

      return;
    }

    reconnectingGuilds.add(guildId);

    console.log(`🔄 Starting reconnect process | Guild ${guildId}`);

    // Tunggu 2 detik
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    try {
      const currentGuild = client.guilds.cache.get(guildId);

      if (!currentGuild) {
        console.log(`❌ Guild not found | ${guildId}`);

        reconnectingGuilds.delete(guildId);

        return;
      }

      // ------------------------------------------
      // Ambil channel dari storage
      // ------------------------------------------

      const channelId = afkChannels.get(guildId);

      if (!channelId) {
        console.log(`❌ No reconnect channel is stored | Guild ${guildId}`);

        reconnectingGuilds.delete(guildId);

        return;
      }

      const currentChannel = currentGuild.channels.cache.get(channelId);

      if (!currentChannel) {
        console.log(`❌ Voice channel not found | Channel ${channelId}`);

        reconnectingGuilds.delete(guildId);

        return;
      }

      console.log(`🔄 Creating new connection to ${currentChannel.name}`);

      // Hancurkan connection lama
      const oldConnection = getVoiceConnection(guildId);

      if (oldConnection) {
        oldConnection.destroy();
      }

      // Buat connection baru
      createVoiceConnection(currentGuild, currentChannel);

      console.log(`✅ New connection created | Guild ${guildId}`);
    } catch (error) {
      console.error(`❌ Reconnect failed | Guild ${guildId}`, error);

      reconnectingGuilds.delete(guildId);
    }
  });

  return connection;
}

// ==================================================
// RESTORE AFK CONNECTIONS
// ==================================================

async function restoreAfkConnections() {
  console.log("=================================");
  console.log("🔄 Restoring AFK connections...");
  console.log("=================================");

  for (const [guildId, channelId] of afkChannels) {
    try {
      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        console.log(`⚠️ Guild not found | ${guildId}`);

        continue;
      }

      const channel = guild.channels.cache.get(channelId);

      if (!channel) {
        console.log(`⚠️ Voice channel not found | ${channelId}`);

        continue;
      }

      console.log(`🔄 Rejoining ${channel.name} | Guild ${guildId}`);

      const existingConnection = getVoiceConnection(guildId);

      if (existingConnection) {
        existingConnection.destroy();
      }

      manualDisconnects.delete(guildId);

      createVoiceConnection(guild, channel);
    } catch (error) {
      console.error(`❌ Failed to restore guild ${guildId}:`, error);
    }
  }
}

// ==================================================
// BOT READY
// ==================================================

client.once(Events.ClientReady, async () => {
  console.log("=================================");
  console.log(`BOT ONLINE: ${client.user.tag}`);
  console.log("=================================");

  // Load data dari file
  loadAfkChannels();

  // Tunggu sebentar agar guild/channel cache siap
  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });

  // Restore semua AFK connection
  await restoreAfkConnections();
});

// ==================================================
// INTERACTION
// ==================================================

client.on(Events.InteractionCreate, async (interaction) => {
  console.log("INTERACTION RECEIVED:");
  console.log("Command:", interaction.commandName);
  console.log("Guild:", interaction.guildId);

  if (!interaction.isChatInputCommand()) {
    return;
  }

  // ==========================================
  // /JOIN
  // ==========================================

  if (interaction.commandName === "join") {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply("❌ You must be in a voice channel.");

      return;
    }

    const guildId = interaction.guildId;

    // Hapus status disconnect manual
    manualDisconnects.delete(guildId);

    // Simpan channel tujuan
    afkChannels.set(guildId, voiceChannel.id);

    // Simpan ke file
    saveAfkChannels();

    const existingConnection = getVoiceConnection(guildId);

    if (existingConnection) {
      await interaction.reply(`🎧 Bot is already in **${voiceChannel.name}**.`);

      return;
    }

    try {
      createVoiceConnection(interaction.guild, voiceChannel);

      await interaction.reply(
        `🎧 Successfully joined **${voiceChannel.name}**.`,
      );
    } catch (error) {
      console.error("❌ Error while joining voice channel:", error);

      await interaction.reply({
        content: "❌ Failed to join the voice channel.",
        ephemeral: true,
      });
    }

    return;
  }

  // ==========================================
  // /LEAVE
  // ==========================================

  if (interaction.commandName === "leave") {
    const guildId = interaction.guildId;

    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply(
        "❌ The bot is not currently in a voice channel.",
      );

      return;
    }

    // Tandai sebagai disconnect manual
    manualDisconnects.add(guildId);

    // Hentikan reconnect
    reconnectingGuilds.delete(guildId);

    // Hapus AFK channel dari memory
    afkChannels.delete(guildId);

    // Hapus AFK channel dari file
    saveAfkChannels();

    // Disconnect
    connection.destroy();

    console.log(`👋 Bot left the voice channel | Guild ${guildId}`);

    await interaction.reply("👋 Bot has left the voice channel.");

    return;
  }

  // ==========================================
  // /TESTDISCONNECT
  // ==========================================

  if (interaction.commandName === "testdisconnect") {
    const guildId = interaction.guildId;

    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply(
        "❌ The bot is not currently in a voice channel.",
      );

      return;
    }

    const channelId = afkChannels.get(guildId);

    if (!channelId) {
      await interaction.reply("❌ No reconnect channel is stored.");

      return;
    }

    const channel = interaction.guild.channels.cache.get(channelId);

    if (!channel) {
      await interaction.reply("❌ The bot's voice channel could not be found.");

      return;
    }

    // Pastikan disconnect dianggap
    // sebagai disconnect yang harus direconnect
    manualDisconnects.delete(guildId);

    await interaction.reply("🧪 Simulating a voice connection disconnect...");

    console.log("=================================");
    console.log(`🧪 TEST DISCONNECT | Guild ${guildId}`);
    console.log(`🎧 Channel: ${channel.name}`);
    console.log("=================================");

    connection.disconnect();

    return;
  }

  // ==========================================
  // /STATUS
  // ==========================================

  if (interaction.commandName === "status") {
    const guildId = interaction.guildId;

    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply(
        "🔴 **OFFLINE** — The bot is not in a voice channel.",
      );

      return;
    }

    let channel = interaction.guild.members.me?.voice?.channel;

    // Fallback menggunakan storage
    if (!channel) {
      const channelId = afkChannels.get(guildId);

      if (channelId) {
        channel = interaction.guild.channels.cache.get(channelId);
      }
    }

    await interaction.reply(
      `🟢 **ONLINE**\n` +
        `📡 Status: \`${connection.state.status}\`\n` +
        `🎧 Channel: **${channel ? channel.name : "Unknown"}**`,
    );

    return;
  }
});

// ==================================================
// START BOT
// ==================================================

client.login(process.env.DISCORD_TOKEN);
