require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { Client, GatewayIntentBits, Events } = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
} = require("@discordjs/voice");


// ==================================================
// CONFIGURATION
// ==================================================

const BOT_NAME = "AFUK AFK BOT";
const VERSION = "1.0.0";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// ==================================================
// RENDER HEALTH SERVER
// ==================================================

const http = require("http");
const PORT = process.env.PORT || 3000;

const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("AFUK AFK BOT is running.\\n");
});

healthServer.listen(PORT, "0.0.0.0", () => {
  logInfo(`HTTP health server listening on port ${PORT}`);
});

// ==================================================
// AFK STORAGE
// ==================================================

const AFK_FILE = path.join(__dirname, "afk-channels.json");

const afkChannels = new Map();

// Guild yang sengaja melakukan /leave
const manualDisconnects = new Set();

// Mencegah reconnect ganda
const reconnectingGuilds = new Set();

// Menyimpan audio player setiap guild
const audioPlayers = new Map();

// ==================================================
// CONSOLE
// ==================================================

function logHeader() {
  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log(`║              ${BOT_NAME.padEnd(28)}║`);
  console.log(`║              Version ${VERSION.padEnd(19)}║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
}

function logSection(title) {
  console.log("");
  console.log(`┌─ ${title}`);
}

function logInfo(message) {
  console.log(`│  ${message}`);
}

function logSuccess(message) {
  console.log(`│  ✓ ${message}`);
}

function logWarning(message) {
  console.log(`│  ! ${message}`);
}

function logError(message) {
  console.log(`│  ✕ ${message}`);
}

// ==================================================
// LOAD AFK DATA
// ==================================================

function loadAfkChannels() {
  try {
    if (!fs.existsSync(AFK_FILE)) {
      fs.writeFileSync(AFK_FILE, JSON.stringify({}, null, 2));

      logInfo("Created AFK storage file.");
      return;
    }

    const data = fs.readFileSync(AFK_FILE, "utf8");

    const parsedData = JSON.parse(data);

    for (const [guildId, channelId] of Object.entries(parsedData)) {
      afkChannels.set(guildId, channelId);
    }

    logSuccess(`Loaded ${afkChannels.size} saved AFK channel(s).`);
  } catch (error) {
    logError("Failed to load AFK data.");
    console.error(error);
  }
}

// ==================================================
// SAVE AFK DATA
// ==================================================

function saveAfkChannels() {
  try {
    const data = Object.fromEntries(afkChannels);

    fs.writeFileSync(AFK_FILE, JSON.stringify(data, null, 2));

    logSuccess("AFK configuration saved.");
  } catch (error) {
    logError("Failed to save AFK data.");
    console.error(error);
  }
}

// ==================================================
// PRE-ENCODED SILENT OPUS AUDIO
// ==================================================

const SILENT_AUDIO_FILE = path.join(__dirname, "silent.opus");

function startSilentAudio(guildId, connection) {
  stopSilentAudio(guildId);

  if (!fs.existsSync(SILENT_AUDIO_FILE)) {
    throw new Error(`Missing silent audio file: ${SILENT_AUDIO_FILE}`);
  }

  const player = createAudioPlayer({
    behaviors: {
      maxMissedFrames: 250,
    },
  });

  const playSilentFile = () => {
    if (!audioPlayers.has(guildId)) return;

    const stream = fs.createReadStream(SILENT_AUDIO_FILE);
    const resource = createAudioResource(stream, {
      inputType: StreamType.OggOpus,
      inlineVolume: false,
    });

    resource.playStream.on("error", (error) => {
      logError(`Silent audio stream error | Guild ${guildId}`);
      console.error(error);
    });

    player.play(resource);
  };

  player.on(AudioPlayerStatus.Playing, () => {
    logSuccess(`Pre-encoded silent audio ACTIVE | Guild ${guildId}`);
  });

  player.on(AudioPlayerStatus.Idle, () => {
    logInfo(`Silent audio file ended; restarting | Guild ${guildId}`);
    setImmediate(playSilentFile);
  });

  player.on("error", (error) => {
    logError(`Audio player error | Guild ${guildId}`);
    console.error(error);
  });

  connection.subscribe(player);

  audioPlayers.set(guildId, { player });
  playSilentFile();

  logInfo("Audio mode: PRE-ENCODED OPUS SILENCE");
  logInfo("No real-time Opus encoding is performed.");
  logInfo("Users will hear absolutely nothing.");
}

// ==================================================
// STOP SILENT AUDIO
// ==================================================

function stopSilentAudio(guildId) {
  const audio = audioPlayers.get(guildId);
  if (!audio) return;

  try { audio.player.stop(true); } catch (error) {}
  audioPlayers.delete(guildId);
  logInfo(`Silent audio stopped | Guild ${guildId}`);
}

// ==================================================
// CREATE VOICE CONNECTION
// ==================================================

function createVoiceConnection(guild, channel) {
  const guildId = guild.id;

  logSection("VOICE CONNECTION");

  logInfo(`Guild   : ${guild.name}`);
  logInfo(`Channel : ${channel.name}`);
  logInfo(`Guild ID: ${guildId}`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: guild.voiceAdapterCreator,

    // Bot does not need to receive audio.
    selfDeaf: true,

    // IMPORTANT:
    // We are transmitting silent audio.
    selfMute: false,
  });

  // ==============================================
  // READY
  // ==============================================

  connection.on(VoiceConnectionStatus.Ready, () => {
    logSection("VOICE READY");

    logSuccess(`Connected to ${channel.name}`);

    logSuccess("Pre-encoded silent audio transmission started.");

    reconnectingGuilds.delete(guildId);

    startSilentAudio(guildId, connection);
  });

  // ==============================================
  // DISCONNECTED
  // ==============================================

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logSection("VOICE DISCONNECTED");

    logWarning(`Connection lost | Guild ${guildId}`);

    stopSilentAudio(guildId);

    // Intentional /leave
    if (manualDisconnects.has(guildId)) {
      logInfo("Disconnect was intentional.");

      return;
    }

    // Reconnect already running
    if (reconnectingGuilds.has(guildId)) {
      logInfo("Reconnect process already running.");

      return;
    }

    reconnectingGuilds.add(guildId);

    logInfo("Starting automatic reconnect...");

    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    try {
      const currentGuild = client.guilds.cache.get(guildId);

      if (!currentGuild) {
        logError(`Guild not found | ${guildId}`);

        reconnectingGuilds.delete(guildId);

        return;
      }

      const channelId = afkChannels.get(guildId);

      if (!channelId) {
        logError("No saved AFK channel found.");

        reconnectingGuilds.delete(guildId);

        return;
      }

      const currentChannel = currentGuild.channels.cache.get(channelId);

      if (!currentChannel) {
        logError(`Voice channel not found | ${channelId}`);

        reconnectingGuilds.delete(guildId);

        return;
      }

      logInfo(`Reconnecting to ${currentChannel.name}...`);

      const oldConnection = getVoiceConnection(guildId);

      if (oldConnection) {
        stopSilentAudio(guildId);
        oldConnection.destroy();
      }

      manualDisconnects.delete(guildId);

      createVoiceConnection(currentGuild, currentChannel);

      logSuccess("Reconnect initiated successfully.");
    } catch (error) {
      logError(`Reconnect failed | Guild ${guildId}`);

      console.error(error);

      reconnectingGuilds.delete(guildId);
    }
  });

  return connection;
}

// ==================================================
// RESTORE AFK CONNECTIONS
// ==================================================

async function restoreAfkConnections() {
  logSection("AFK RESTORE");

  if (afkChannels.size === 0) {
    logInfo("No saved AFK connections found.");

    return;
  }

  logInfo(`Restoring ${afkChannels.size} AFK connection(s)...`);

  for (const [guildId, channelId] of afkChannels) {
    try {
      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        logWarning(`Guild unavailable | ${guildId}`);

        continue;
      }

      const channel = guild.channels.cache.get(channelId);

      if (!channel) {
        logWarning(`Voice channel unavailable | ${channelId}`);

        continue;
      }

      logInfo(`Restoring ${guild.name} → ${channel.name}`);

      const existingConnection = getVoiceConnection(guildId);

      if (existingConnection) {
        stopSilentAudio(guildId);
        existingConnection.destroy();
      }

      manualDisconnects.delete(guildId);

      createVoiceConnection(guild, channel);
    } catch (error) {
      logError(`Failed to restore guild ${guildId}`);

      console.error(error);
    }
  }
}

// ==================================================
// BOT READY
// ==================================================

client.once(Events.ClientReady, async () => {
  logHeader();

  console.log(`✓ Logged in as ${client.user.tag}`);

  console.log(`✓ Bot ID      : ${client.user.id}`);

  console.log(`✓ Guilds      : ${client.guilds.cache.size}`);

  console.log("✓ Voice mode   : Persistent AFK");

  console.log("✓ Audio mode   : Pre-encoded Opus silence");

  console.log("");

  loadAfkChannels();

  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });

  await restoreAfkConnections();

  logSection("SYSTEM READY");

  logSuccess("AFUK AFK BOT is ready.");

  logInfo("Use /join to enter a voice channel.");

  logInfo("Use /leave to disconnect.");

  logInfo("Use /status to check the current state.");

  logInfo("Use /testdisconnect to test recovery.");

  console.log("");
});

// ==================================================
// INTERACTION
// ==================================================

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const guildId = interaction.guildId;

  console.log(
    `\n[COMMAND] /${interaction.commandName} | ${interaction.guild?.name || guildId}`,
  );

  // ============================================
  // /JOIN
  // ============================================

  if (interaction.commandName === "join") {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply("❌ You must be in a voice channel.");

      return;
    }

    manualDisconnects.delete(guildId);

    afkChannels.set(guildId, voiceChannel.id);

    saveAfkChannels();

    const existingConnection = getVoiceConnection(guildId);

    if (existingConnection) {
      await interaction.reply(`🎧 Bot is already in **${voiceChannel.name}**.`);

      return;
    }

    try {
      createVoiceConnection(interaction.guild, voiceChannel);

      await interaction.reply(
        `🎧 Successfully joined **${voiceChannel.name}**.\n🔇 Silent mode is active.`,
      );
    } catch (error) {
      logError("Failed to join voice channel.");

      console.error(error);

      await interaction.reply({
        content: "❌ Failed to join the voice channel.",
        ephemeral: true,
      });
    }

    return;
  }

  // ============================================
  // /LEAVE
  // ============================================

  if (interaction.commandName === "leave") {
    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply(
        "❌ The bot is not currently in a voice channel.",
      );

      return;
    }

    manualDisconnects.add(guildId);
    reconnectingGuilds.delete(guildId);

    afkChannels.delete(guildId);

    saveAfkChannels();

    stopSilentAudio(guildId);

    connection.destroy();

    logSection("AFK SESSION CLOSED");

    logSuccess(`Disconnected from ${interaction.guild.name}`);

    await interaction.reply("👋 Bot has left the voice channel.");

    return;
  }

  // ============================================
  // /TESTDISCONNECT
  // ============================================

  if (interaction.commandName === "testdisconnect") {
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

    manualDisconnects.delete(guildId);

    await interaction.reply(
      "🧪 Testing voice recovery. The bot will reconnect automatically.",
    );

    logSection("RECOVERY TEST");

    logInfo(`Guild   : ${interaction.guild.name}`);

    logInfo(`Channel : ${channel.name}`);

    logInfo("Simulating voice connection loss...");

    connection.disconnect();

    return;
  }

  // ============================================
  // /STATUS
  // ============================================

  if (interaction.commandName === "status") {
    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply(
        "🔴 **OFFLINE** — The bot is not in a voice channel.",
      );

      return;
    }

    let channel = interaction.guild.members.me?.voice?.channel;

    if (!channel) {
      const channelId = afkChannels.get(guildId);

      if (channelId) {
        channel = interaction.guild.channels.cache.get(channelId);
      }
    }

    const audio = audioPlayers.get(guildId);

    const audioStatus = audio ? audio.player.state.status : "Not active";

    await interaction.reply(
      `🟢 **ONLINE**\n` +
        `📡 Connection: \`${connection.state.status}\`\n` +
        `🎧 Channel: **${channel ? channel.name : "Unknown"}**\n` +
        `🔇 Audio: **Pre-encoded Opus silence**\n` +
        `🎵 Stream: \`${audioStatus}\``,
    );

    return;
  }
});

// ==================================================
// PROCESS ERROR HANDLING
// ==================================================

process.on("unhandledRejection", (error) => {
  logError("Unhandled promise rejection.");
  console.error(error);
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception.");
  console.error(error);
});

// ==================================================
// START BOT
// ==================================================

logSection("STARTUP");

logInfo("Starting Discord connection...");

client.login(process.env.DISCORD_TOKEN);
