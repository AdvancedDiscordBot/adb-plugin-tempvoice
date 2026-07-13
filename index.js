const setupCommand = require("./commands/setup");
const setupCategoryCommand = require("./commands/setup-category");
const nameCommand = require("./commands/name");
const limitCommand = require("./commands/limit");
const lockCommand = require("./commands/lock");
const unlockCommand = require("./commands/unlock");
const permitCommand = require("./commands/permit");
const denyCommand = require("./commands/deny");
const claimCommand = require("./commands/claim");
const renameCommand = require("./commands/rename");
const bitrateCommand = require("./commands/bitrate");
const TempVoiceConfig = require("./models/tempVoiceConfig");
const TempVoiceChannelModel = require("./models/tempVoiceChannel");
const nodeCron = require("node-cron");

/**
 * Every ADB plugin exports a single `load(ctx)` function. `ctx` is frozen
 * and namespaced to this plugin — see README.md for the full API reference.
 */
async function load(ctx) {
  // --- Register all slash commands -------------------------------------------------
  ctx.registerCommand(setupCommand);
  ctx.registerCommand(setupCategoryCommand);
  ctx.registerCommand(nameCommand);
  ctx.registerCommand(limitCommand);
  ctx.registerCommand(lockCommand);
  ctx.registerCommand(unlockCommand);
  ctx.registerCommand(permitCommand);
  ctx.registerCommand(denyCommand);
  ctx.registerCommand(claimCommand);
  ctx.registerCommand(renameCommand);
  ctx.registerCommand(bitrateCommand);

  // --- Define models ---------------------------------------------------------------
  const ChannelConfig = ctx.defineModel("TempVoiceConfig", TempVoiceConfig);
  const TempVoiceChannel = ctx.defineModel("TempVoiceChannel", TempVoiceChannelModel);

  // --- Setup cron job for cleanup (every 30 seconds) -------------------------------
  nodeCron.schedule("*/30 * * * * *", async () => {
    try {
      const now = Date.now();
      const expired = await TempVoiceChannel.find({ deleteAt: { $lte: now } });
      for (const channel of expired) {
        try {
          const guild = ctx.client.guilds.cache.get(channel.guildId);
          if (guild) {
            const ch = guild.channels.cache.get(channel.channelId);
            if (ch && ch.deletable) {
              await ch.delete();
            }
          }
          await TempVoiceChannel.deleteOne({ _id: channel._id });
        } catch (err) {
          ctx.logger.error(`Failed to delete temp voice channel ${channel.channelId}:`, err);
        }
      }
    } catch (err) {
      ctx.logger.error("Error in temp voice channel cleanup cron:", err);
    }
  });

  // --- Event handler for voiceStateUpdate ------------------------------------------
  ctx.registerEvent("voiceStateUpdate", async (oldState, newState) => {
    try {
      const guildId = newState.guildId;
      if (!guildId) return;

      const config = await ChannelConfig.findOne({ guildId });
      if (!config || !config.creationChannelId) return;

      // User joins the creation channel
      if (
        oldState.channelId !== config.creationChannelId &&
        newState.channelId === config.creationChannelId
      ) {
        const guild = ctx.client.guilds.cache.get(guildId);
        if (!guild) return;

        // Determine channel name
        let channelName = config.nameTemplate;
        const member = await guild.members.fetch(newState.member.user.id);
        if (member) {
          channelName = channelName
            .replace(/{user}/g, member.toString())
            .replace(/{username}/g, member.user.username);
        }

        // Check max channels limit
        if (config.maxChannels > 0) {
          const currentCount = await TempVoiceChannel.countDocuments({ guildId });
          if (currentCount >= config.maxChannels) {
            // TODO: notify user via DM or ephemeral message? For now, just don't create.
            return;
          }
        }

        // Create the channel
        const category = guild.channels.cache.get(config.categoryId);
        const channel = await guild.channels.create(channelName, {
          type: 2, // GUILD_VOICE
          parent: category ? category.id : null,
          bitrate: config.bitrateDefault,
          userLimit: config.userLimitDefault,
        });

        // Set permissions: give the creator full permissions
        await channel.permissionOverwrites.edit(member, {
          Connect: true,
          Speak: true,
          ViewChannel: true,
        });

        // Save to DB
        await TempVoiceChannel.create({
          guildId,
          channelId: channel.id,
          creatorId: member.user.id,
          createdAt: new Date(),
          deleteAt: new Date(Date.now() + config.autoDeleteDelay * 60 * 1000),
          locked: false,
          bitrate: config.bitrateDefault,
          userLimit: config.userLimitDefault,
        });
      }

      // User leaves a channel (any channel)
      if (
        oldState.channelId &&
        newState.channelId !== oldState.channelId
      ) {
        const tempChannel = await TempVoiceChannel.findOne({
          channelId: oldState.channelId,
          guildId,
        });
        if (!tempChannel) return;

        // Check if the channel is now empty
        const channel = await ctx.client.channels.fetch(oldState.channelId).catch(() => null);
        if (channel && channel.members.size === 0) {
          // Set deletion time if not already set
          if (!tempChannel.deleteAt) {
            const delay = config.autoDeleteDelay * 60 * 1000;
            tempChannel.deleteAt = new Date(Date.now() + delay);
            await tempChannel.save();
          }
        } else {
          // If someone joins, clear the deletion time
          if (tempChannel.deleteAt) {
            tempChannel.deleteAt = null;
            await tempChannel.save();
          }
        }
      }
    } catch (err) {
      ctx.logger.error("Error in voiceStateUpdate handler:", err);
    }
  });
}

module.exports = { load };
