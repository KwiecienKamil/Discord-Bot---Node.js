require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const ytpl = require("ytpl");
const queueManager = require("./queue");

// ---------- Discord client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const CLIENT_ID = process.env.APP_ID;
const TOKEN = process.env.BOT_TOKEN;

// ---------- Slash commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption((opt) =>
      opt.setName("url").setDescription("YouTube URL").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Play a YouTube playlist")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("YouTube playlist URL")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear the queue"),
].map((cmd) => cmd.toJSON());

// Register slash commands
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered!");
  } catch (err) {
    console.error("Error registering commands:", err);
  }
})();

// ---------- URL cleaner ----------
function cleanYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be")
      return `https://www.youtube.com/watch?v=${parsed.pathname.slice(1)}`;
    if (parsed.hostname.includes("youtube.com") && parsed.searchParams.has("v"))
      return `https://www.youtube.com/watch?v=${parsed.searchParams.get("v")}`;
    return url;
  } catch {
    return url;
  }
}

// ---------- Button row ----------
function createMusicButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("play")
      .setLabel("▶️ Play")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pause")
      .setLabel("⏸️ Pause")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("skip")
      .setLabel("⏭️ Skip")
      .setStyle(ButtonStyle.Danger)
  );
}

// ---------- Interaction handler ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand() && !interaction.isButton()) return;

  const guildId = interaction.guild.id;
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel)
    return interaction.reply({
      content: "You must be in a voice channel!",
      flags: MessageFlags.Ephemeral,
    });

  // Button handling
  if (interaction.isButton()) {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No music playing!",
        flags: MessageFlags.Ephemeral,
      });
    switch (interaction.customId) {
      case "pause":
        serverQueue.player.pause();
        break;
      case "play":
        serverQueue.player.unpause();
        break;
      case "skip":
        queueManager.skip(guildId);
        break;
    }
    return interaction.reply({
      content: `Button pressed: ${interaction.customId}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // /play command
  if (interaction.commandName === "play") {
    const rawUrl = interaction.options.getString("url");
    const url = cleanYouTubeUrl(rawUrl);
    console.log("Play command URL:", url);

    const song = { title: "Loading...", url };
    let serverQueue = queueManager.getQueue(guildId);

    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      serverQueue = queueManager.createQueue(guildId, voiceChannel, connection);
      serverQueue.songs.push(song);

      await interaction.reply({
        content: `Now playing: ${song.url}`,
        components: [createMusicButtons()],
      });
      queueManager.playSong(guildId, song, interaction);
    } else {
      queueManager.addSong(guildId, song);
      await interaction.reply({ content: `Added to queue: ${song.url}` });
    }
  }

  // /playlist command
  if (interaction.commandName === "playlist") {
    const rawUrl = interaction.options.getString("url");
    const playlistUrl = cleanYouTubeUrl(rawUrl);
    let playlist;
    try {
      playlist = await ytpl(playlistUrl, { limit: Infinity });
    } catch {
      return interaction.reply({
        content: "Invalid playlist URL!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const songs = playlist.items.map((item) => ({
      title: item.title,
      url: cleanYouTubeUrl(item.shortUrl),
    }));
    let serverQueue = queueManager.getQueue(guildId);

    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      serverQueue = queueManager.createQueue(guildId, voiceChannel, connection);
      queueManager.addPlaylist(guildId, songs);

      await interaction.reply({
        content: `Playing playlist: ${playlist.title} (${songs.length} songs)`,
        components: [createMusicButtons()],
      });
      queueManager.playSong(guildId, serverQueue.songs[0], interaction);
    } else {
      queueManager.addPlaylist(guildId, songs);
      await interaction.reply({
        content: `Added ${songs.length} songs from playlist: ${playlist.title}`,
      });
    }
  }

  // /skip command
  if (interaction.commandName === "skip") {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No song is currently playing.",
        flags: MessageFlags.Ephemeral,
      });
    queueManager.skip(guildId);
    await interaction.reply({
      content: "Skipped the beat!",
      flags: MessageFlags.Ephemeral,
    });
  }

  // /stop command
  if (interaction.commandName === "stop") {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No music to stop.",
        flags: MessageFlags.Ephemeral,
      });
    queueManager.stop(guildId);
    await interaction.reply({
      content: "Stopped music and cleared the queue.",
      flags: MessageFlags.Ephemeral,
    });
  }
});

client.once("ready", () =>
  console.log("David Baguetta is ready to drop beats! 🥖🎶")
);
client.login(TOKEN);
