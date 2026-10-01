"use strict";

const { PermissionFlagsBits: P } = require("discord.js");
const nodeCron = require("node-cron");
const { createVoiceCommand } = require("./commands/voice");
const configSchema = require("./models/tempVoiceConfig");
const channelSchema = require("./models/tempVoiceChannel");
const { PLUGIN_NAME, readConfig, validateConfig, validDeleteDelay } = require("./lib/config");
const { OWNER_PERMISSIONS, fetchChannel, hasOccupants, copyOverwrites, setOverwrite } = require("./lib/channels");

async function load(ctx) {
	const LegacyConfig = ctx.defineModel("TempVoiceConfig", configSchema);
	const TempVoiceChannel = ctx.defineModel("TempVoiceChannel", channelSchema);
	const client = ctx.client;
	const getConfig = (guildId) => readConfig(ctx.db, LegacyConfig, guildId);
	const saveConfig = (guildId, config) => ctx.db.updatePluginConfig(guildId, PLUGIN_NAME, config);
	let active = true;
	let cleaning = false;
	const guildQueues = new Map();
	const pendingVoiceUpdates = new Set();

	// Gateway events, commands, and cleanup share the same guild queue. In-flight
	// creation counts toward limits, and a second claimant sees the first owner.
	function runInGuild(guildId, operation) {
		const previous = guildQueues.get(guildId) || Promise.resolve();
		const next = previous.catch(() => {}).then(() => active ? operation() : undefined);
		guildQueues.set(guildId, next);
		return next.finally(() => {
			if (guildQueues.get(guildId) === next) guildQueues.delete(guildId);
		});
	}

	ctx.registerCommand(createVoiceCommand({ TempVoiceChannel, getConfig, saveConfig, runInGuild, logger: ctx.logger }));

	async function reconcileChannel(guild, channelId, config, deleteExpired) {
		const filter = { guildId: guild.id, channelId };
		const doc = await TempVoiceChannel.findOne(filter);
		if (!doc || !active) return;
		const channel = await fetchChannel(guild, channelId);
		if (!active || !client.isReady() || guild.available === false) return;
		if (!channel) {
			await TempVoiceChannel.deleteOne(filter);
			return;
		}
		if (channel.type !== 2) {
			ctx.logger.warn(`Refusing to clean up non-voice channel ${channelId}.`);
			return;
		}
		if (hasOccupants(channel) || (!doc.pendingCleanup && config.autoDeleteDelay === 0)) {
			if (doc.deleteAt != null) await TempVoiceChannel.updateOne(filter, { $set: { deleteAt: null } });
			return;
		}
		if (!doc.pendingCleanup) {
			if (!validDeleteDelay(config.autoDeleteDelay)) {
				ctx.logger.warn(`Invalid auto-delete delay for guild ${guild.id}; keeping ${channelId}.`);
				return;
			}
			if (!doc.deleteAt) {
				await TempVoiceChannel.updateOne(filter, { $set: { deleteAt: new Date(Date.now() + config.autoDeleteDelay * 60000) } });
				return;
			}
			if (+doc.deleteAt > Date.now()) return;
		}
		if (!deleteExpired || !channel.deletable || hasOccupants(channel)) return;
		try {
			await channel.delete("Empty temporary voice channel");
		} catch (error) {
			if (error.code !== 10003) throw error;
		}
		await TempVoiceChannel.deleteOne(filter);
	}

	// --- Occupancy and join-to-create --------------------------------------------
	ctx.registerEvent("voiceStateUpdate", async (oldState, newState) => {
		const guild = newState.guild || oldState.guild;
		// Discord patches cached VoiceState objects in place on later packets.
		const oldChannelId = oldState.channelId;
		const newChannelId = newState.channelId;
		if (!active || !client.isReady() || !guild || guild.available === false || oldChannelId === newChannelId) return;
		const key = `${guild.id}:${newState.id}:${newChannelId}`;
		if (pendingVoiceUpdates.has(key)) return;
		pendingVoiceUpdates.add(key);
		try {
			await runInGuild(guild.id, async () => {
				const config = await getConfig(guild.id);
				// Cleanup is independent of whether join-to-create is still configured.
				for (const channelId of new Set([oldChannelId, newChannelId].filter(Boolean))) {
					await reconcileChannel(guild, channelId, config, false);
				}
				if (!active || !config.creationChannelId || newChannelId !== config.creationChannelId) return;
				const member = newState.member || await guild.members.fetch(newState.id);
				if (!member || member.user.bot) return;
				const stillJoining = () => active && client.isReady() && guild.available !== false &&
					guild.voiceStates.cache.get(member.id)?.channelId === config.creationChannelId;
				if (!stillJoining()) return;
				const error = validateConfig(config);
				if (error) {
					ctx.logger.warn(`Invalid tempvoice config for ${guild.id}: ${error}`);
					return;
				}
				const creation = await fetchChannel(guild, config.creationChannelId);
				const category = config.categoryId ? await fetchChannel(guild, config.categoryId) : null;
				if (!creation || creation.type !== 2 || (config.categoryId && (!category || category.type !== 4))) {
					ctx.logger.warn(`Invalid creation channel or category for guild ${guild.id}.`);
					return;
				}
				const bot = guild.members.me || await guild.members.fetchMe();
				const destinationPermissions = category ? category.permissionsFor(bot) : bot.permissions;
				if (!creation.permissionsFor(bot)?.has([P.ViewChannel, P.Connect, P.MoveMembers]) ||
					!destinationPermissions?.has([P.ViewChannel, P.Connect, P.Speak, P.MoveMembers, P.ManageChannels, P.ManageRoles])) {
					ctx.logger.warn(`Missing bot permissions to create or move voice members in guild ${guild.id}.`);
					return;
				}
				if (config.maxChannels > 0 && await TempVoiceChannel.countDocuments({ guildId: guild.id }) >= config.maxChannels) return;
				if (!stillJoining()) return;
				const name = config.nameTemplate.replace(/\{username\}|\{user\}/g, (placeholder) =>
					placeholder === "{username}" ? member.user.username : member.displayName,
				).trim().slice(0, 100);
				const bitrate = Math.min(config.bitrateDefault, guild.maximumBitrate);
				let overwrites = category ? copyOverwrites(category) : [];
				overwrites = setOverwrite(overwrites, member.id, 1, OWNER_PERMISSIONS); // Member overwrite
				overwrites = setOverwrite(overwrites, bot.id, 1, OWNER_PERMISSIONS);
				const state = {
					guildId: guild.id, creatorId: member.id, userId: member.id,
					bitrate, userLimit: config.userLimitDefault, deleteAt: null,
				};
				let channel;
				try {
					channel = await guild.channels.create({
						name, type: 2, parent: category?.id ?? null, // GUILD_VOICE
						bitrate, userLimit: config.userLimitDefault, permissionOverwrites: overwrites,
						reason: "Join-to-create temporary voice channel",
					});
					if (!stillJoining()) throw new Error("Creation cancelled before moving the member.");
					await TempVoiceChannel.create({ ...state, channelId: channel.id });
					if (!stillJoining()) throw new Error("Creation cancelled before moving the member.");
					await member.voice.setChannel(channel, "Move to your temporary voice channel");
				} catch (creationError) {
					ctx.logger.error(`Failed to provision a temporary voice channel in ${guild.id}:`, creationError);
					if (!channel) return;
					let removed = false;
					if (guild.available !== false && client.isReady() && channel.deletable && !hasOccupants(channel)) {
						try {
							await channel.delete("Roll back failed temporary voice creation");
							removed = true;
						} catch (rollbackError) {
							removed = rollbackError.code === 10003;
							if (!removed) ctx.logger.error(`Failed to roll back channel ${channel.id}:`, rollbackError);
						}
					}
					if (removed) {
						await TempVoiceChannel.deleteOne({ guildId: guild.id, channelId: channel.id });
					} else {
						// An occupied channel or failed Discord delete must stay tracked for
						// safe retry, even if normal auto-deletion has been disabled.
						try {
							await TempVoiceChannel.updateOne(
								{ guildId: guild.id, channelId: channel.id },
								{ $set: { ...state, pendingCleanup: true } }, { upsert: true, runValidators: true },
							);
						} catch (trackingError) {
							ctx.logger.error(`Could not track failed channel ${channel.id} in ${guild.id}; manual recovery required:`, trackingError);
						}
					}
				}
			});
		} catch (error) {
			ctx.logger.error(`Error handling voice state in ${guild.id}:`, error);
		} finally {
			pendingVoiceUpdates.delete(key);
		}
	});

	// --- Restart reconciliation and expired empty channels -----------------------
	const job = nodeCron.schedule("*/30 * * * * *", async () => {
		if (!active || cleaning || !client.isReady()) return;
		cleaning = true;
		try {
			const byGuild = new Map();
			for (const doc of await TempVoiceChannel.find({})) {
				if (!byGuild.has(doc.guildId)) byGuild.set(doc.guildId, []);
				byGuild.get(doc.guildId).push(doc.channelId);
			}
			for (const [guildId, channelIds] of byGuild) {
				if (!active) break;
				const guild = client.guilds.cache.get(guildId);
				if (!guild || guild.available === false) continue;
				await runInGuild(guildId, async () => {
					const config = await getConfig(guildId);
					for (const channelId of channelIds) {
						if (!active) break;
						try { await reconcileChannel(guild, channelId, config, true); }
						catch (error) { ctx.logger.error(`Failed to clean up temporary channel ${channelId}:`, error); }
					}
				}).catch((error) => ctx.logger.error(`Failed tempvoice cleanup for guild ${guildId}:`, error));
			}
		} catch (error) {
			ctx.logger.error("Failed to load temporary channels for cleanup:", error);
		} finally {
			cleaning = false;
		}
	});

	const unsubscribe = ctx.hooks.on("onPluginUnload", async ({ pluginName }) => {
		if (pluginName !== PLUGIN_NAME) return;
		active = false;
		unsubscribe();
		await job.stop();
		await job.destroy();
		await Promise.allSettled([...guildQueues.values()]);
	});
}

module.exports = { load };
