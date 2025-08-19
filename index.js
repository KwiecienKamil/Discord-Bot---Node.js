require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const ytdl = require("ytdl-core");
const ytpl = require("ytpl");
const queueManager = require("./queue");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const CLIENT_ID = process.env.APP_ID;
const TOKEN = process.env.BOT_TOKEN;

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption((option) =>
      option.setName("url").setDescription("YouTube URL").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Play a YouTube playlist")
    .addStringOption((option) =>
      option
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
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

client.once("ready", () => {
  console.log("David Baguetta is ready to drop beats! 🥖🎶");
});

// Button row
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

// Handle interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand() && !interaction.isButton()) return;

  const guildId = interaction.guild.id;
  const voiceChannel = interaction.member?.voice?.channel;

  // Button interaction
  if (interaction.isButton()) {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No music playing!",
        ephemeral: true,
      });

    switch (interaction.customId) {
      case "pause":
        serverQueue.player.pause();
        return interaction.reply({
          content: "⏸️ Pauzuje to gówno",
          ephemeral: true,
        });
      case "play":
        serverQueue.player.unpause();
        return interaction.reply({
          content: "▶️ Dobra lecim dalej",
          ephemeral: true,
        });
      case "skip":
        queueManager.skip(guildId);
        return interaction.reply({ content: "⏭️ Skip!", ephemeral: true });
    }
    return;
  }

  if (!voiceChannel)
    return interaction.reply({
      content: "You must be in a voice channel!",
      ephemeral: true,
    });

  // /play command
  if (interaction.commandName === "play") {
    const url = interaction.options.getString("url");
    if (!ytdl.validateURL(url))
      return interaction.reply({
        content: "Invalid YouTube URL!",
        ephemeral: true,
      });

    const song = { title: "Loading...", url };
    let serverQueue = queueManager.getQueue(guildId);

    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      serverQueue = queueManager.createQueue(guildId, voiceChannel, connection);
      serverQueue.songs.push(song);

      await interaction.reply({
        content: `Tera gramy: ${song.url}`,
        components: [createMusicButtons()],
      });

      queueManager.playSong(guildId, song);
    } else {
      queueManager.addSong(guildId, song);
      await interaction.reply({
        content: `Added to queue: ${song.url}`,
        ephemeral: false,
      });
    }
  }

  // /playlist command
  if (interaction.commandName === "playlist") {
    const playlistUrl = interaction.options.getString("url");
    let playlist;
    try {
      playlist = await ytpl(playlistUrl, { limit: Infinity });
    } catch (err) {
      return interaction.reply({
        content: "Invalid playlist URL!",
        ephemeral: true,
      });
    }

    const songs = playlist.items.map((item) => ({
      title: item.title,
      url: item.shortUrl,
    }));
    let serverQueue = queueManager.getQueue(guildId);

    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      serverQueue = queueManager.createQueue(guildId, voiceChannel, connection);
      queueManager.addPlaylist(guildId, songs);

      await interaction.reply({
        content: `Tera gramy playlistę: ${playlist.title} (${songs.length} songs)`,
        components: [createMusicButtons()],
      });

      queueManager.playSong(guildId, serverQueue.songs[0]);
    } else {
      queueManager.addPlaylist(guildId, songs);
      await interaction.reply({
        content: `Dodano ${songs.length} utworów z playlisty: ${playlist.title}`,
        ephemeral: false,
      });
    }
  }

  // /skip command
  if (interaction.commandName === "skip") {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No song is currently playing.",
        ephemeral: true,
      });

    queueManager.skip(guildId);
    await interaction.reply({
      content: "Skipped the baguette beat!",
      ephemeral: true,
    });
  }

  // /stop command
  if (interaction.commandName === "stop") {
    const serverQueue = queueManager.getQueue(guildId);
    if (!serverQueue)
      return interaction.reply({
        content: "No music to stop.",
        ephemeral: true,
      });

    queueManager.stop(guildId);
    await interaction.reply({
      content: "Stopped the music and cleared the queue.",
      ephemeral: true,
    });
  }
});

client.login(TOKEN);
