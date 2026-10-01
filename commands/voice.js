"use strict";

const { EmbedBuilder, PermissionFlagsBits: P } = require("discord.js");
const { validateConfig } = require("../lib/config");
const { OWNER_PERMISSIONS, fetchChannel, copyOverwrites, setOverwrite } = require("../lib/channels");

const ADMIN_COMMANDS = ["setup", "setup-category", "name", "limit", "bitrate"];
const channelOption = { type: 7, name: "channel", description: "Temporary channel (defaults to your current voice channel)", channel_types: [2] }; // CHANNEL, GUILD_VOICE
const categoryOption = { type: 7, name: "category", description: "Category for new temporary channels", channel_types: [4] }; // CHANNEL, GUILD_CATEGORY
const bitrateOption = { type: 4, name: "bitrate", description: "Default bitrate in bps (subject to this server's tier)", min_value: 8000, max_value: 384000 }; // INTEGER
const targetOptions = [
	channelOption,
	{ type: 6, name: "user", description: "User to permit or deny (choose either user or role)" }, // USER
	{ type: 8, name: "role", description: "Role to permit or deny (choose either user or role)" }, // ROLE
];

function createVoiceCommand({ TempVoiceChannel, getConfig, saveConfig, runInGuild, logger }) {
	return {
		data: {
			name: "voice",
			description: "Configure and manage temporary voice channels",
			dm_permission: false,
			// SUB_COMMAND (1); admin checks belong to the settings subcommands,
			// not the root command, so ordinary channel owners can use controls.
			options: [
				{ type: 1, name: "setup", description: "View or update temporary voice defaults (Manage Channels)", options: [
					{ type: 7, name: "creation-channel", description: "Voice channel members join to create a room", channel_types: [2] },
					categoryOption,
					{ type: 3, name: "name-template", description: "Channel template with {username} or {user}", min_length: 1, max_length: 100 }, // STRING
					{ type: 4, name: "auto-delete-minutes", description: "Empty-channel deletion delay in minutes (0 = disabled)", min_value: 0 },
					{ type: 4, name: "max-channels", description: "Maximum temporary channels per server (0 = unlimited)", min_value: 0 },
					bitrateOption,
					{ type: 4, name: "user-limit", description: "Default user limit (0 = unlimited)", min_value: 0, max_value: 99 },
				] },
				{ type: 1, name: "setup-category", description: "Set the category for new channels (Manage Channels)", options: [{ ...categoryOption, required: true }] },
				{ type: 1, name: "name", description: "Set the naming template for new channels (Manage Channels)", options: [
					{ type: 3, name: "template", description: "Template with {username} or {user}", required: true, min_length: 1, max_length: 100 },
				] },
				{ type: 1, name: "limit", description: "Set the default user limit for new channels (Manage Channels)", options: [
					{ type: 4, name: "limit", description: "Default user limit (0 = unlimited)", required: true, min_value: 0, max_value: 99 },
				] },
				{ type: 1, name: "bitrate", description: "Set the default bitrate for new channels (Manage Channels)", options: [{ ...bitrateOption, required: true }] },
				{ type: 1, name: "lock", description: "Block @everyone from joining your temporary channel", options: [
					channelOption,
					{ type: 5, name: "lock", description: "true = lock (default), false = unlock" }, // BOOLEAN
				] },
				{ type: 1, name: "unlock", description: "Restore your channel's previous @everyone Connect setting", options: [channelOption] },
				{ type: 1, name: "rename", description: "Rename your temporary channel", options: [
					{ type: 3, name: "name", description: "New channel name", required: true, min_length: 1, max_length: 100 },
					channelOption,
				] },
				{ type: 1, name: "permit", description: "Permit a user or role to join your temporary channel", options: targetOptions },
				{ type: 1, name: "deny", description: "Deny a user or role future access to your temporary channel", options: targetOptions },
				{ type: 1, name: "claim", description: "Claim the temporary channel you are in when its owner is absent", options: [channelOption] },
			],
		},

		async execute(interaction) {
			const guild = interaction.guild;
			if (!guild) return interaction.reply({ content: "Use /voice in a server.", ephemeral: true });
			const subcommand = interaction.options.getSubcommand();
			const isAdmin = interaction.memberPermissions?.has(P.ManageChannels) === true;
			if (ADMIN_COMMANDS.includes(subcommand) && !isAdmin) {
				return interaction.reply({ content: "You need the **Manage Channels** permission to change server defaults.", ephemeral: true });
			}
			await interaction.deferReply({ ephemeral: true });
			let response;
			try {
				response = await runInGuild(guild.id, async () => {
					if (ADMIN_COMMANDS.includes(subcommand)) {
						const config = await getConfig(guild.id);
						const changes = {};
						if (subcommand === "setup" || subcommand === "setup-category") {
							for (const [option, key, type] of [["creation-channel", "creationChannelId", 2], ["category", "categoryId", 4]]) {
								const selected = interaction.options.getChannel(option);
								if (!selected) continue;
								if (selected.guild?.id !== guild.id || selected.type !== type) {
									return { content: `The ${option} must be a ${type === 4 ? "category" : "voice channel"} in this server.` };
								}
								changes[key] = selected.id;
							}
							if (subcommand === "setup-category" && !changes.categoryId) return { content: "Choose a category." };
						}
						if (subcommand === "setup") {
							const template = interaction.options.getString("name-template");
							if (template !== null) changes.nameTemplate = template;
							for (const [option, key] of [["auto-delete-minutes", "autoDeleteDelay"], ["max-channels", "maxChannels"], ["bitrate", "bitrateDefault"], ["user-limit", "userLimitDefault"]]) {
								const value = interaction.options.getInteger(option);
								if (value !== null) changes[key] = value;
							}
						}
						if (subcommand === "name") changes.nameTemplate = interaction.options.getString("template");
						if (subcommand === "limit") changes.userLimitDefault = interaction.options.getInteger("limit");
						if (subcommand === "bitrate") changes.bitrateDefault = interaction.options.getInteger("bitrate");
						const next = { ...config, ...changes };
						const error = validateConfig(next, changes.bitrateDefault === undefined ? 384000 : guild.maximumBitrate);
						if (error) return { content: error };
						if (Object.keys(changes).length) {
							next.creatorId ||= interaction.user.id;
							await saveConfig(guild.id, next);
						}
						return { embeds: [new EmbedBuilder()
							.setColor(0x2ecc71)
							.setTitle("Temporary Voice Settings")
							.setDescription("These defaults apply to new channels. The deletion delay is used when a channel becomes empty.")
							.addFields(
								{ name: "Creation Channel", value: next.creationChannelId ? `<#${next.creationChannelId}>` : "Not configured", inline: true },
								{ name: "Category", value: next.categoryId ? `<#${next.categoryId}>` : "Server root", inline: true },
								{ name: "Name Template", value: next.nameTemplate },
								{ name: "Auto-Delete", value: next.autoDeleteDelay === 0 ? "Disabled" : `${next.autoDeleteDelay} minutes`, inline: true },
								{ name: "Max Channels", value: `${next.maxChannels} (0 = unlimited)`, inline: true },
								{ name: "Default Bitrate", value: `${next.bitrateDefault} bps`, inline: true },
								{ name: "Default User Limit", value: `${next.userLimitDefault} (0 = unlimited)`, inline: true },
							).setTimestamp()] };
					}

					const selected = interaction.options.getChannel("channel");
					if (selected && selected.guild?.id !== guild.id) return { content: "Choose a temporary voice channel in this server." };
					const channelId = selected?.id || guild.voiceStates.cache.get(interaction.user.id)?.channelId;
					if (!channelId) return { content: "Join a temporary voice channel or specify its channel option." };
					const channel = await fetchChannel(guild, channelId);
					if (!channel || channel.type !== 2) return { content: "Choose an existing temporary voice channel." };
					const doc = await TempVoiceChannel.findOne({ guildId: guild.id, channelId });
					if (!doc) return { content: "This channel is not a tracked temporary voice channel." };
					if (subcommand !== "claim" && doc.creatorId !== interaction.user.id && !isAdmin) {
						return { content: "Only the channel owner or a **Manage Channels** user can manage this channel." };
					}
					const bot = guild.members.me || await guild.members.fetchMe();
					const required = subcommand === "rename" ? [P.ViewChannel, P.ManageChannels] : [P.ViewChannel, P.ManageChannels, P.ManageRoles];
					if (!channel.permissionsFor(bot)?.has(required)) return { content: "The bot is missing permissions to manage this channel." };
					if (subcommand === "rename") {
						const name = interaction.options.getString("name")?.trim();
						if (!name || name.length > 100) return { content: "The channel name must be 1-100 characters." };
						await channel.setName(name);
						return { content: `Renamed your temporary channel to **${name}**.` };
					}

					const before = copyOverwrites(channel);
					let overwrites = before;
					const changes = {};
					let content;
					if (subcommand === "lock" || subcommand === "unlock") {
						const locked = subcommand === "lock" && (interaction.options.getBoolean("lock") ?? true);
						if (locked === doc.locked) return { content: `The channel is already ${locked ? "locked" : "unlocked"}.` };
						const everyone = channel.permissionOverwrites.cache.get(guild.id);
						changes.locked = locked;
						changes.previousConnect = null;
						if (locked && everyone?.allow.has(P.Connect, false)) changes.previousConnect = true;
						if (locked && everyone?.deny.has(P.Connect, false)) changes.previousConnect = false;
						const connect = locked ? false : doc.previousConnect ?? null;
						overwrites = setOverwrite(overwrites, guild.id, 0, { Connect: connect });
						content = locked ? "Locked: @everyone cannot join. Explicit permits and administrators may still connect. Nobody is prevented from leaving."
							: "Unlocked: restored the previous @everyone Connect setting. Other access restrictions still apply.";
					} else if (subcommand === "permit" || subcommand === "deny") {
						const user = interaction.options.getUser("user");
						const role = interaction.options.getRole("role");
						if ((!user && !role) || (user && role)) return { content: "Choose exactly one user or role." };
						if (role && (role.id === guild.id || role.guild?.id !== guild.id)) return { content: "Choose a role from this server other than @everyone; use /voice lock or unlock for everyone." };
						const permit = subcommand === "permit";
						if (!permit && (user?.id === doc.creatorId || user?.id === bot.id)) return { content: "You cannot deny the channel owner or the bot." };
						if (!permit && role && bot.roles.cache.has(role.id)) return { content: "You cannot deny a role held by the bot." };
						const targetId = (user || role).id;
						overwrites = setOverwrite(overwrites, targetId, role ? 0 : 1, { Connect: permit, ViewChannel: permit });
						const suffix = role ? "Roles" : "Users";
						const allowed = new Set(doc[`allowed${suffix}`] || []);
						const denied = new Set(doc[`disallowed${suffix}`] || []);
						(permit ? allowed : denied).add(targetId);
						(permit ? denied : allowed).delete(targetId);
						changes[`allowed${suffix}`] = [...allowed];
						changes[`disallowed${suffix}`] = [...denied];
						content = permit ? "Access permitted. Other Discord role and administrator rules still apply." : "Future access denied. Connected members are not disconnected; Discord administrator and overwrite precedence still apply.";
					} else if (subcommand === "claim") {
						if (guild.voiceStates.cache.get(interaction.user.id)?.channelId !== channelId) return { content: "You must be in this channel to claim it." };
						if (doc.creatorId === interaction.user.id) return { content: "You already own this channel." };
						if (!isAdmin && (channel.members.has(doc.creatorId) || guild.voiceStates.cache.get(doc.creatorId)?.channelId === channelId)) {
							return { content: "The current owner is still in this channel. Only a Manage Channels user can override ownership." };
						}
						changes.creatorId = interaction.user.id;
						changes.userId = interaction.user.id;
						changes.allowedUsers = (doc.allowedUsers || []).filter((id) => id !== doc.creatorId && id !== interaction.user.id);
						changes.disallowedUsers = (doc.disallowedUsers || []).filter((id) => id !== doc.creatorId && id !== interaction.user.id);
						overwrites = setOverwrite(overwrites.filter((entry) => entry.id !== doc.creatorId), interaction.user.id, 1, OWNER_PERMISSIONS);
						content = "Claimed this temporary channel. You can now manage it with /voice.";
					} else {
						return { content: "Unknown /voice subcommand." };
					}

					// One Discord update, then persist. Restore access if the DB rejects it.
					await channel.permissionOverwrites.set(overwrites);
					try {
						const result = await TempVoiceChannel.updateOne(
							{ guildId: guild.id, channelId, creatorId: doc.creatorId }, { $set: changes }, { runValidators: true },
						);
						if (!result.matchedCount) throw new Error("Channel ownership changed during the command.");
					} catch (error) {
						try { await channel.permissionOverwrites.set(before); }
						catch (rollbackError) { logger.error(`Failed to restore permissions for ${channelId}:`, rollbackError); }
						throw error;
					}
					return { content };
				});
			} catch (error) {
				logger.error(`Failed /voice ${subcommand} in ${guild.id}:`, error);
				response = { content: "Unable to complete that voice command. Check the bot's permissions and try again." };
			}
			await interaction.editReply({ allowedMentions: { parse: [] }, ...(response || { content: "The tempvoice plugin has been unloaded." }) });
		},
	};
}

module.exports = { createVoiceCommand };
