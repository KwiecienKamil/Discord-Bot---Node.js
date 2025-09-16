// queue.js
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const ytdl = require("@distube/ytdl-core");

// Utility to clean YouTube URLs
function cleanYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be")
      return `https://www.youtube.com/watch?v=${parsed.pathname.slice(1)}`;
    if (
      parsed.hostname.includes("youtube.com") &&
      parsed.searchParams.has("v")
    ) {
      return `https://www.youtube.com/watch?v=${parsed.searchParams.get("v")}`;
    }
    return url;
  } catch {
    return url;
  }
}

// Retry helper for ytdl streams
async function getYTDLStream(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const stream = ytdl(url, {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25, // 32 MB buffer
        requestOptions: {
          headers: { cookie: process.env.YT_COOKIE_HEADER || "" },
        },
      });
      return stream;
    } catch (err) {
      console.warn(`ytdl failed (attempt ${i + 1}):`, err.message);
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

class MusicQueue {
  constructor() {
    this.queues = new Map();
  }

  createQueue(guildId, voiceChannel, connection) {
    const queueConstruct = {
      voiceChannel,
      connection,
      songs: [],
      player: createAudioPlayer(),
      message: null,
    };
    this.queues.set(guildId, queueConstruct);
    return queueConstruct;
  }

  getQueue(guildId) {
    return this.queues.get(guildId);
  }

  addSong(guildId, song, interaction = null) {
    const queue = this.getQueue(guildId);
    if (!queue) return;

    song.url = cleanYouTubeUrl(song.url);
    queue.songs.push(song);

    if (queue.player.state.status === "idle") {
      this.playSong(guildId, queue.songs[0], interaction);
    }
  }

  addPlaylist(guildId, songsArray, interaction = null) {
    const queue = this.getQueue(guildId);
    if (!queue) return;

    songsArray = songsArray.map((s) => ({ ...s, url: cleanYouTubeUrl(s.url) }));
    queue.songs.push(...songsArray);

    if (queue.player.state.status === "idle" && queue.songs.length > 0) {
      this.playSong(guildId, queue.songs[0], interaction);
    }
  }

  skip(guildId) {
    const queue = this.getQueue(guildId);
    if (queue) queue.player.stop();
  }

  stop(guildId) {
    const queue = this.getQueue(guildId);
    if (queue) {
      queue.player.stop();
      queue.connection.destroy();
      this.queues.delete(guildId);
    }
  }

  generateButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("play_pause")
        .setLabel("⏯️ Play/Pause")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("skip")
        .setLabel("⏭️ Skip")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  async playSong(guildId, song, interaction = null) {
    const queue = this.getQueue(guildId);
    if (!queue) return;

    if (!song) {
      console.log("Queue empty, leaving voice channel.");
      queue.connection.destroy();
      this.queues.delete(guildId);
      return;
    }

    console.log("Attempting to play:", song.url);

    let stream;
    try {
      stream = await getYTDLStream(song.url);

      const info = await ytdl.getInfo(song.url, {
        requestOptions: {
          headers: { cookie: process.env.YT_COOKIE_HEADER || "" },
        },
      });
      song.title = info.videoDetails.title;
      console.log("Fetched video info:", song.title);
    } catch (err) {
      console.error("Error fetching YouTube stream:", err);
      queue.songs.shift();
      return this.playSong(guildId, queue.songs[0], interaction);
    }

    const resource = createAudioResource(stream);
    queue.player.play(resource);
    queue.connection.subscribe(queue.player);

    // Interaction reply handling
    if (interaction) {
      try {
        if (!queue.message) {
          if (interaction.replied || interaction.deferred) {
            queue.message = await interaction.editReply({
              content: `🎶 Now playing: ${song.title}`,
              components: [this.generateButtons()],
            });
          } else {
            await interaction.reply({
              content: `🎶 Now playing: ${song.title}`,
              components: [this.generateButtons()],
            });
            queue.message = await interaction.fetchReply();
          }
        } else {
          queue.message = await queue.message.edit({
            content: `🎶 Now playing: ${song.title}`,
            components: [this.generateButtons()],
          });
        }

        // Button collector
        const collector = queue.message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 0,
        });

        collector.on("collect", async (btnInteraction) => {
          if (btnInteraction.customId === "play_pause") {
            queue.player.state.status === "playing"
              ? queue.player.pause()
              : queue.player.unpause();
            await btnInteraction.update({
              components: [this.generateButtons()],
            });
          }
          if (btnInteraction.customId === "skip") {
            queue.player.stop();
            await btnInteraction.update({
              content: "⏭️ Skipped!",
              components: [this.generateButtons()],
            });
          }
        });
      } catch (err) {
        console.warn("Interaction handling failed:", err.message);
      }
    }

    // Audio player events
    queue.player.on(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      this.playSong(guildId, queue.songs[0], interaction);
    });

    queue.player.on("error", (err) => {
      console.error("Audio player error:", err);
      queue.songs.shift();
      this.playSong(guildId, queue.songs[0], interaction);
    });
  }
}

module.exports = new MusicQueue();
