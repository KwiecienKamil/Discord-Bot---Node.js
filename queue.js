const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const ytdl = require("ytdl-core");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

class MusicQueue {
  constructor() {
    this.queues = new Map();
  }

  createQueue(guildId, voiceChannel, connection) {
    const queueContruct = {
      voiceChannel,
      connection,
      songs: [],
      player: createAudioPlayer(),
      message: null,
    };
    this.queues.set(guildId, queueContruct);
    return queueContruct;
  }

  getQueue(guildId) {
    return this.queues.get(guildId);
  }

  addSong(guildId, song, interaction = null) {
    const queue = this.queues.get(guildId);
    if (!queue) return;

    queue.songs.push(song);

    if (queue.player.state.status === "idle") {
      this.playSong(guildId, queue.songs[0], interaction);
    }
  }

  addPlaylist(guildId, songsArray, interaction = null) {
    const queue = this.queues.get(guildId);
    if (!queue) return;

    queue.songs.push(...songsArray);

    if (queue.player.state.status === "idle" && queue.songs.length > 0) {
      this.playSong(guildId, queue.songs[0], interaction);
    }
  }

  skip(guildId) {
    const queue = this.queues.get(guildId);
    if (queue) queue.player.stop();
  }

  stop(guildId) {
    const queue = this.queues.get(guildId);
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
    const queue = this.queues.get(guildId);
    if (!queue) return;

    if (!song) {
      queue.connection.destroy();
      this.queues.delete(guildId);
      return;
    }

    let stream;
    try {
      if (!ytdl.validateURL(song.url)) throw new Error("Invalid YouTube URL");
      stream = ytdl(song.url, { filter: "audioonly", highWaterMark: 1 << 25 });
    } catch (error) {
      console.error(`Error creating stream for ${song.url}:`, error.message);
      queue.songs.shift();
      return this.playSong(guildId, queue.songs[0], interaction);
    }

    const resource = createAudioResource(stream);
    queue.player.play(resource);
    queue.connection.subscribe(queue.player);

    if (interaction) {
      if (!queue.message) {
        await interaction.reply({
          content: `🎶 Now playing: ${song.url}`,
          components: [this.generateButtons()],
        });
        queue.message = await interaction.fetchReply();
      } else {
        queue.message = await queue.message.edit({
          content: `🎶 Now playing: ${song.url}`,
          components: [this.generateButtons()],
        });
      }

      const collector = queue.message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 0,
      });

      collector.on("collect", async (btnInteraction) => {
        if (!queue) return;

        if (btnInteraction.customId === "play_pause") {
          if (queue.player.state.status === "playing") queue.player.pause();
          else queue.player.unpause();

          await btnInteraction.update({ components: [this.generateButtons()] });
        }

        if (btnInteraction.customId === "skip") {
          queue.player.stop();
          await btnInteraction.update({
            content: `⏭️ Skipped! Now playing next song...`,
            components: [this.generateButtons()],
          });
        }
      });
    }

    queue.player.on(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      this.playSong(guildId, queue.songs[0], interaction);
    });

    queue.player.on("error", (err) => {
      console.error(`Audio player error in guild ${guildId}:`, err.message);
      queue.songs.shift();
      this.playSong(guildId, queue.songs[0], interaction);
    });
  }
}

module.exports = new MusicQueue();
