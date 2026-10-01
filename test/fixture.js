"use strict";

const assert = require("node:assert/strict");
const { Collection, PermissionFlagsBits: P, PermissionsBitField, PermissionOverwrites, VoiceState } = require("discord.js");
const nodeCron = require("node-cron");
const { createMockCtx } = require("./mock-ctx");
const { load } = require("../index");

const PLUGIN = "adb-plugin-tempvoice";

async function fixture() {
	const mock = createMockCtx({ pluginName: PLUGIN });
	const { ctx, models, registeredCommands, emitEvent, hooks } = mock;
	const jobs = [];
	const errors = [];
	const warnings = [];
	ctx.logger.error = (...args) => errors.push(args);
	ctx.logger.warn = (...args) => warnings.push(args);
	ctx.logger.info = () => {};
	let ready = true;
	ctx.client.isReady = () => ready;
	const guild = {
		id: "100000000000000001",
		available: true,
		maximumBitrate: 96000,
		client: ctx.client,
		voiceStates: { cache: new Collection() },
		members: { cache: new Collection() },
		roles: { everyone: { id: "100000000000000001" }, cache: new Collection() },
		channels: { cache: new Collection() },
	};
	ctx.client.guilds.cache.set(guild.id, guild);
	const created = [];
	const moves = [];
	const deleted = [];
	let nextId = 100;

	function channel(id, type = 2) {
		const overwrites = new Collection();
		const result = {
			id, type, guild, guildId: guild.id, name: id, deletable: true,
			botPermissions: new PermissionsBitField(PermissionsBitField.All),
			permissionsFor(member) {
				return member.id === ctx.client.user.id ? this.botPermissions : member.permissions;
			},
			get members() {
				return guild.members.cache.filter((member) => guild.voiceStates.cache.get(member.id)?.channelId === id);
			},
			permissionOverwrites: {
				cache: overwrites,
				async set(entries) {
					overwrites.clear();
					for (const entry of entries) {
						overwrites.set(entry.id, {
							id: entry.id, type: entry.type,
							allow: new PermissionsBitField(entry.allow || 0n),
							deny: new PermissionsBitField(entry.deny || 0n),
						});
					}
					return result;
				},
				async edit(target, options, extra = {}) {
					const targetId = typeof target === "string" ? target : target.id;
					const previous = overwrites.get(targetId);
					const bits = PermissionOverwrites.resolveOverwriteOptions(options, previous);
					overwrites.set(targetId, { id: targetId, type: extra.type ?? previous?.type ?? 1, ...bits });
					return result;
				},
				async delete(target) {
					overwrites.delete(typeof target === "string" ? target : target.id);
					return result;
				},
			},
			async setName(name) {
				assert.equal(typeof name, "string");
				assert.ok(name.length >= 1 && name.length <= 100);
				this.name = name;
				return this;
			},
			async delete() {
				assert.equal(this.members.size, 0, "never delete an occupied channel");
				assert.ok(!guild.voiceStates.cache.some((state) => state.channelId === id), "uncached members are occupants too");
				deleted.push(id);
				guild.channels.cache.delete(id);
				return this;
			},
		};
		guild.channels.cache.set(id, result);
		return result;
	}

	function setVoice(member, channelId) {
		const state = new VoiceState(guild, { user_id: member.id, channel_id: channelId });
		guild.voiceStates.cache.set(member.id, state);
		return state;
	}

	function member(id, admin = false) {
		const result = {
			id, guild, displayName: `Display ${id}`,
			user: { id, username: `user-${id}`, bot: false },
			roles: { cache: new Collection([[guild.id, guild.roles.everyone]]) },
			permissions: new PermissionsBitField(admin ? PermissionsBitField.All : [P.ViewChannel, P.Connect, P.Speak]),
			get voice() { return guild.voiceStates.cache.get(id); },
		};
		guild.members.cache.set(id, result);
		setVoice(result, null);
		return result;
	}

	const bot = member(ctx.client.user.id, true);
	bot.user.bot = true;
	guild.members.me = bot;
	guild.members.fetchMe = async () => bot;
	guild.members.fetch = async (id) => guild.members.cache.get(id);
	guild.members.edit = async (id, options) => {
		assert.ok(Object.hasOwn(options, "channel"), "VoiceState.setChannel must use GuildMemberManager.edit");
		const targetId = typeof options.channel === "string" ? options.channel : options.channel?.id ?? null;
		const target = guild.members.cache.get(id);
		moves.push({ memberId: id, channelId: targetId });
		setVoice(target, targetId);
		return target;
	};
	guild.channels.fetch = async (id) => {
		const result = guild.channels.cache.get(id);
		if (!result) throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
		return result;
	};
	ctx.client.channels.fetch = (id) => guild.channels.fetch(id);
	guild.channels.create = async (...args) => {
		assert.equal(args.length, 1, "discord.js v14 takes one creation options object");
		const [options] = args;
		assert.equal(typeof options, "object");
		assert.equal(options.type, 2);
		assert.ok(options.name.length >= 1 && options.name.length <= 100);
		assert.ok(options.bitrate >= 8000 && options.bitrate <= guild.maximumBitrate);
		assert.ok(Number.isInteger(options.userLimit) && options.userLimit >= 0 && options.userLimit <= 99);
		const result = channel(`200000000000000${nextId++}`);
		Object.assign(result, { name: options.name, bitrate: options.bitrate, userLimit: options.userLimit, parentId: options.parent ?? null });
		await result.permissionOverwrites.set(options.permissionOverwrites || []);
		created.push({ channel: result, options });
		return result;
	};
	const creation = channel("100000000000000002");
	const category = channel("100000000000000003", 4);
	const text = channel("100000000000000004", 0);
	const owner = member("100000000000000005");
	const other = member("100000000000000006");
	const admin = member("100000000000000007", true);

	async function reload() {
		const schedule = nodeCron.schedule;
		nodeCron.schedule = (expression, tick) => {
			const job = { expression, tick, stops: 0, destroys: 0, stop() { this.stops++; }, destroy() { this.destroys++; } };
			jobs.push(job);
			return job;
		};
		try { await load(ctx); } finally { nodeCron.schedule = schedule; }
	}
	await reload();
	const TempVoiceChannel = models.get(`plugin_${PLUGIN}_TempVoiceChannel`);
	const LegacyConfig = models.get(`plugin_${PLUGIN}_TempVoiceConfig`);
	const configure = (data = {}) => ctx.db.updatePluginConfig(guild.id, PLUGIN, {
		creationChannelId: creation.id, categoryId: category.id, ...data,
	});
	const config = async () => (await ctx.db.getPluginConfig(guild.id, PLUGIN)).data;
	async function transition(target, channelId) {
		const before = new VoiceState(guild, { user_id: target.id, channel_id: target.voice.channelId });
		const after = setVoice(target, channelId);
		await emitEvent("voiceStateUpdate", before, after);
	}
	async function tracked(data = {}) {
		const result = channel(`300000000000000${nextId++}`);
		await TempVoiceChannel.create({ guildId: guild.id, channelId: result.id, creatorId: owner.id, userId: owner.id, ...data });
		await result.permissionOverwrites.edit(owner.id, { Connect: true, Speak: true, ViewChannel: true });
		return result;
	}
	const doc = (target) => TempVoiceChannel.findOne({ guildId: guild.id, channelId: target.id });
	async function command(subcommand, options = {}, actor = admin, overrides = {}) {
		const replies = [];
		const interaction = {
			guild, guildId: guild.id, channel: text, user: actor.user, member: actor, memberPermissions: actor.permissions,
			options: {
				getSubcommand: () => subcommand,
				...Object.fromEntries(["Channel", "String", "Integer", "Boolean", "User", "Role"].map((type) => [`get${type}`, (name) => options[name] ?? null])),
			},
			replied: false, deferred: false,
			async reply(payload) { assert.ok(!this.replied && !this.deferred); this.replied = true; replies.push(payload); },
			async deferReply(payload) { assert.ok(!this.replied && !this.deferred); assert.equal(payload.ephemeral, true); this.deferred = true; },
			async editReply(payload) { assert.ok(this.deferred); this.replied = true; replies.push(payload); },
			...overrides,
		};
		assert.ok(registeredCommands.has("voice"), "load(ctx) registers /voice");
		await registeredCommands.get("voice").execute(interaction, ctx.client);
		assert.equal(replies.length, 1, "commands send exactly one final response");
		for (const embed of replies[0].embeds || []) embed.toJSON();
		return replies[0];
	}
	return {
		...mock, guild, bot, owner, other, admin, creation, category, text, created, moves, deleted, errors, warnings, jobs,
		TempVoiceChannel, LegacyConfig, configure, config, channel, member, setVoice, transition, tracked, doc, command, reload,
		setReady: (value) => { ready = value; },
		tick: () => jobs.at(-1).tick(),
		close: () => hooks.emitHook("onPluginUnload", { pluginName: PLUGIN }),
	};
}

module.exports = { fixture, PLUGIN, P, PermissionsBitField };
