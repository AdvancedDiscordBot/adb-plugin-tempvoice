"use strict";

const assert = require("node:assert/strict");
const { VoiceState } = require("discord.js");
const { fixture, PLUGIN, P, PermissionsBitField } = require("./fixture");
const manifest = require("../plugin.json");

const tests = [];
const test = (name, run) => tests.push({ name, run });
const ownerCommands = ["lock", "unlock", "rename", "permit", "deny"];
const adminCommands = ["setup", "setup-category", "name", "limit", "bitrate"];
const overwrite = (channel, id, permission) => {
	const entry = channel.permissionOverwrites.cache.get(id);
	if (entry?.allow.has(permission, false)) return true;
	if (entry?.deny.has(permission, false)) return false;
	return null;
};
const snapshot = (channel) => [...channel.permissionOverwrites.cache.values()].map((entry) => ({
	id: entry.id, type: entry.type, allow: entry.allow.bitfield, deny: entry.deny.bitfield,
}));
const fail = () => { throw new Error("simulated failure"); };

async function until(predicate) {
	for (let i = 0; i < 40 && !predicate(); i++) await new Promise(setImmediate);
	assert.ok(predicate(), "the expected asynchronous operation started");
}

test("load registers only /voice without hiding owner subcommands behind ManageChannels", async (f) => {
	assert.deepEqual([...f.registeredCommands.keys()], ["voice"]);
	const data = f.registeredCommands.get("voice").data;
	const json = data.toJSON ? data.toJSON() : data;
	assert.ok(json.default_member_permissions == null);
	assert.equal(json.dm_permission, false);
	assert.deepEqual(json.options.map((option) => option.name).sort(), [...adminCommands, ...ownerCommands, "claim"].sort());
	for (const name of ["setup", "setup-category"]) {
		assert.deepEqual(json.options.find((option) => option.name === name).options.find((option) => option.name === "category").channel_types, [4]);
	}
	assert.deepEqual(manifest.permissions.system, ["raw-client"]);
	assert.deepEqual(manifest.capabilities.system, ["raw-client"]);
	assert.equal(manifest.requiresRestart, true, "Schema upgrades must recompile cached Mongoose models");
});

test("the real Mongoose schema persists deletion deadlines", async (f) => {
	const channel = await f.tracked({ deleteAt: new Date(1000) });
	assert.equal(+(await f.doc(channel)).deleteAt, 1000);
	await f.TempVoiceChannel.updateOne({ channelId: channel.id }, { $set: { deleteAt: null } });
	assert.equal((await f.doc(channel)).deleteAt, null);
});

test("setup through load(ctx) uses the canonical config and handles omitted embed fields", async (f) => {
	await f.ctx.db.updatePluginConfig(f.guild.id, PLUGIN, { _commands: { voice: { enabled: true } }, custom: "keep" });
	const response = await f.command("setup", { "creation-channel": f.creation, category: f.category });
	assert.ok(response.embeds?.length);
	const config = await f.config();
	assert.equal(config.creationChannelId, f.creation.id);
	assert.equal(config.categoryId, f.category.id);
	assert.equal(config.autoDeleteDelay, 30);
	assert.equal(config.custom, "keep");
	assert.deepEqual(config._commands, { voice: { enabled: true } });
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created.length, 1);
	assert.equal((await f.doc(f.created[0].channel)).creatorId, f.owner.id);
});

test("setup with no options displays a valid defaults embed", async (f) => {
	const response = await f.command("setup");
	assert.ok(response.embeds?.length);
	assert.equal(f.errors.length, 0);
});

test("setup accepts every valid option and preserves zero as deletion disabled", async (f) => {
	await f.command("setup", {
		"creation-channel": f.creation, category: f.category, "name-template": "Room {username}",
		"auto-delete-minutes": 0, "max-channels": 2, bitrate: 96000, "user-limit": 99,
	});
	const config = await f.config();
	assert.equal(config.autoDeleteDelay, 0);
	assert.equal(config.maxChannels, 2);
	assert.equal(config.bitrateDefault, 96000);
	assert.equal(config.userLimitDefault, 99);
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created[0].options.userLimit, 99);
	assert.equal(f.created[0].options.bitrate, 96000);
});

for (const name of adminCommands) {
	test(`${name} rejects non-admins at execution time`, async (f) => {
		const response = await f.command(name, {}, f.owner);
		assert.match(response.content, /Manage Channels/i);
		assert.deepEqual(await f.config(), {});
	});
}

test("/voice rejects DMs without dereferencing guild or member", async (f) => {
	const response = await f.command("claim", {}, f.owner, { guild: null, guildId: null, member: null, memberPermissions: null });
	assert.match(response.content, /server|guild/i);
});

test("all default-setting subcommands affect the next created channel", async (f) => {
	await f.configure({ _commands: { voice: {} } });
	const category = f.channel("replacement-category", 4);
	await f.command("setup-category", { category });
	await f.command("name", { template: "{user} / {username}" });
	await f.command("limit", { limit: 4 });
	await f.command("bitrate", { bitrate: 80000 });
	await f.transition(f.owner, f.creation.id);
	const options = f.created[0].options;
	assert.equal(options.parent, category.id);
	assert.equal(options.name, `${f.owner.displayName} / ${f.owner.user.username}`);
	assert.equal(options.bitrate, 80000);
	assert.equal(options.userLimit, 4);
	assert.deepEqual((await f.config())._commands, { voice: {} });
});

for (const [name, options] of [
	["name", { template: "missing placeholder" }],
	["name", { template: "{username}".repeat(11) }],
	["limit", { limit: -1 }],
	["limit", { limit: 100 }],
	["limit", { limit: 1.5 }],
	["bitrate", { bitrate: 7000 }],
	["bitrate", { bitrate: 97000 }],
	["setup", { "auto-delete-minutes": -1 }],
	["setup", { "auto-delete-minutes": Number.MAX_SAFE_INTEGER }],
	["setup", { "max-channels": -1 }],
	["setup", { "name-template": " " }],
]) {
	test(`${name} rejects invalid options ${JSON.stringify(options)} without writing`, async (f) => {
		await f.configure();
		const before = await f.config();
		const response = await f.command(name, options);
		assert.ok(response.content, "validation responds with an explanation");
		assert.deepEqual(await f.config(), before);
	});
}

for (const name of ["setup", "setup-category"]) {
	test(`${name} rejects forum channels instead of treating type 15 as a category`, async (f) => {
		const response = await f.command(name, { category: f.channel("forum", 15) });
		assert.match(response.content, /category/i);
		assert.deepEqual(await f.config(), {});
	});
}

test("setup rejects foreign-guild channel options and text creation channels", async (f) => {
	await f.command("setup", { "creation-channel": { ...f.creation, guild: { id: "foreign" } } });
	assert.deepEqual(await f.config(), {});
	await f.command("setup", { "creation-channel": f.text });
	assert.deepEqual(await f.config(), {});
});

test("legacy TempVoiceConfig is imported once while preserving reserved dashboard settings", async (f) => {
	await f.ctx.db.updatePluginConfig(f.guild.id, PLUGIN, { _commands: { voice: { enabled: true } } });
	await f.LegacyConfig.create({ guildId: f.guild.id, creationChannelId: f.creation.id, categoryId: f.category.id, nameTemplate: "Legacy {username}", autoDeleteDelay: 10 });
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created[0].options.name, `Legacy ${f.owner.user.username}`);
	assert.equal((await f.config()).autoDeleteDelay, 10);
	assert.deepEqual((await f.config())._commands, { voice: { enabled: true } });
	await f.command("name", { template: "Current {username}" });
	await f.transition(f.other, f.creation.id);
	assert.equal(f.created[1].options.name, `Current ${f.other.user.username}`);
});

test("explicitly disabled canonical config never resurrects legacy creation settings", async (f) => {
	await f.LegacyConfig.create({ guildId: f.guild.id, creationChannelId: f.creation.id, categoryId: f.category.id });
	await f.configure({ creationChannelId: null });
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created.length, 0);
});

test("real VoiceState guild.id and the v14 create API create, track, and move the owner", async (f) => {
	await f.configure();
	await f.category.permissionOverwrites.edit(f.guild.id, { ViewChannel: false }, { type: 0 });
	await f.transition(f.owner, f.creation.id);
	assert.ok(f.owner.voice instanceof VoiceState);
	assert.equal(f.owner.voice.guildId, undefined);
	assert.equal(f.created.length, 1);
	const channel = f.created[0].channel;
	const doc = await f.doc(channel);
	assert.equal(doc.creatorId, f.owner.id);
	assert.equal(doc.userId, f.owner.id);
	assert.equal(doc.deleteAt, null, "occupied channels have no deletion deadline");
	assert.equal(f.owner.voice.channelId, channel.id);
	assert.equal(overwrite(channel, f.guild.id, P.ViewChannel), false, "category overwrites survive creation");
	assert.equal(overwrite(channel, f.owner.id, P.Connect), true);
	assert.equal(overwrite(channel, f.owner.id, P.ManageChannels), null);
	assert.equal(overwrite(channel, f.bot.id, P.Connect), true, "locking must not exclude the bot");
	assert.equal(f.errors.length, 0);
});

test("rendered names are literal and bounded, and a root category is supported", async (f) => {
	await f.configure({ categoryId: null, nameTemplate: "{username}{username}{user}" });
	f.owner.user.username = "$&".repeat(32);
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created[0].options.name, (f.owner.user.username.repeat(2) + f.owner.displayName).slice(0, 100));
	assert.equal(f.created[0].channel.parentId, null);
});

test("a guild bitrate downgrade clamps valid saved defaults to the current tier", async (f) => {
	await f.configure({ bitrateDefault: 384000 });
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created[0].options.bitrate, f.guild.maximumBitrate);
	assert.equal((await f.doc(f.created[0].channel)).bitrate, f.guild.maximumBitrate);
});

for (const [key, value] of [
	["nameTemplate", "no placeholder"], ["nameTemplate", null], ["nameTemplate", "{user}".repeat(20)],
	["maxChannels", -1], ["maxChannels", "2"], ["maxChannels", 0.5],
	["userLimitDefault", 100], ["userLimitDefault", "3"], ["userLimitDefault", null],
	["bitrateDefault", 7999], ["bitrateDefault", 384001], ["bitrateDefault", "64000"],
	["autoDeleteDelay", -1], ["autoDeleteDelay", "30"], ["autoDeleteDelay", Number.MAX_SAFE_INTEGER],
]) {
	test(`creation rejects malformed dashboard config ${key}=${JSON.stringify(value)}`, async (f) => {
		await f.configure({ [key]: value });
		await f.transition(f.owner, f.creation.id);
		assert.equal(f.created.length, 0);
		assert.equal(await f.TempVoiceChannel.countDocuments(), 0);
	});
}

for (const invalid of ["missing-category", "forum-category", "text-creation", "foreign-category"]) {
	test(`creation fails closed for ${invalid}`, async (f) => {
		await f.configure();
		if (invalid === "missing-category") f.guild.channels.cache.delete(f.category.id);
		if (invalid === "forum-category") f.category.type = 15;
		if (invalid === "text-creation") f.creation.type = 0;
		if (invalid === "foreign-category") f.category.guild = { id: "foreign" };
		await f.transition(f.owner, f.creation.id);
		assert.equal(f.created.length, 0);
	});
}

for (const [place, permission] of [
	["creation", P.ViewChannel], ["creation", P.Connect], ["creation", P.MoveMembers],
	["category", P.ManageChannels], ["category", P.ManageRoles], ["category", P.Connect],
]) {
	test(`creation requires effective bot permission ${permission} in ${place}`, async (f) => {
		await f.configure();
		f[place].botPermissions = new PermissionsBitField(PermissionsBitField.All & ~P.Administrator & ~permission);
		await f.transition(f.owner, f.creation.id);
		assert.equal(f.created.length, 0);
	});
}

test("mute updates, bots, and stale join events never create channels", async (f) => {
	await f.configure();
	f.setVoice(f.owner, f.creation.id);
	await f.transition(f.owner, f.creation.id);
	await f.transition(f.bot, f.creation.id);
	const stale = new VoiceState(f.guild, { user_id: f.owner.id, channel_id: f.creation.id });
	f.setVoice(f.owner, null);
	await f.emitEvent("voiceStateUpdate", new VoiceState(f.guild, { user_id: f.owner.id, channel_id: null }), stale);
	assert.equal(f.created.length, 0);
});

test("concurrent joins honor the per-guild maximum", async (f) => {
	await f.configure({ maxChannels: 1 });
	await Promise.all([f.transition(f.owner, f.creation.id), f.transition(f.other, f.creation.id)]);
	assert.equal(f.created.length, 1);
	assert.equal(await f.TempVoiceChannel.countDocuments({ guildId: f.guild.id }), 1);
});

test("duplicate concurrent join events only create one channel for that join", async (f) => {
	await f.configure();
	const oldState = new VoiceState(f.guild, { user_id: f.owner.id, channel_id: null });
	const newState = f.setVoice(f.owner, f.creation.id);
	await Promise.all([f.emitEvent("voiceStateUpdate", oldState, newState), f.emitEvent("voiceStateUpdate", oldState, newState)]);
	assert.equal(f.created.length, 1);
});

test("duplicate joins do not rely on REST moves updating the voice-state cache", async (f) => {
	await f.configure();
	// GuildMemberManager.edit returns a clone; only a gateway update moves the cache.
	f.guild.members.edit = async () => ({ ...f.owner });
	const before = new VoiceState(f.guild, { user_id: f.owner.id, channel_id: null });
	const after = f.setVoice(f.owner, f.creation.id);
	await Promise.all([f.emitEvent("voiceStateUpdate", before, after), f.emitEvent("voiceStateUpdate", before, after)]);
	assert.equal(f.created.length, 1);
	assert.equal(f.owner.voice.channelId, f.creation.id);
	await f.transition(f.owner, f.created[0].channel.id);
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created.length, 2, "a later genuine join may create another channel");
});

test("queued events snapshot mutable Discord voice states before later gateway packets", async (f) => {
	await f.configure();
	f.guild.members.edit = async () => ({ ...f.owner });
	const state = f.owner.voice;
	const otherChannel = f.channel("other-voice");
	const events = [];
	for (const channelId of [f.creation.id, otherChannel.id, f.creation.id]) {
		const before = state._clone();
		state._patch({ channel_id: channelId });
		events.push(f.emitEvent("voiceStateUpdate", before, state));
	}
	await Promise.all(events);
	assert.equal(f.created.length, 1, "a departure must not be reinterpreted as a second creation-channel join");
});

test("create failures leave no tracking rows or moves", async (f) => {
	await f.configure();
	f.guild.channels.create = fail;
	await f.transition(f.owner, f.creation.id);
	assert.equal(await f.TempVoiceChannel.countDocuments(), 0);
	assert.equal(f.moves.length, 0);
	assert.equal(f.errors.length, 1);
});

for (const failing of ["database", "move", "left-creation"]) {
	test(`${failing} failure rolls back the empty channel and tracking row`, async (f) => {
		await f.configure();
		if (failing === "database") f.TempVoiceChannel.create = fail;
		if (failing === "move") f.guild.members.edit = fail;
		if (failing === "left-creation") {
			const create = f.guild.channels.create;
			f.guild.channels.create = async (options) => { const channel = await create(options); f.setVoice(f.owner, null); return channel; };
		}
		await f.transition(f.owner, f.creation.id);
		assert.equal(f.created.length, 1);
		assert.deepEqual(f.deleted, [f.created[0].channel.id]);
		assert.equal(await f.TempVoiceChannel.countDocuments(), 0);
		assert.equal(f.moves.length, 0);
	});
}

test("failed rollback remains tracked and is retried even when auto-delete is disabled", async (f) => {
	await f.configure({ autoDeleteDelay: 0 });
	const create = f.guild.channels.create;
	f.guild.channels.create = async (options) => { const channel = await create(options); channel.deletable = false; return channel; };
	f.guild.members.edit = fail;
	await f.transition(f.owner, f.creation.id);
	const channel = f.created[0].channel;
	assert.ok(await f.doc(channel));
	assert.equal(f.deleted.length, 0);
	channel.deletable = true;
	await f.tick();
	assert.deepEqual(f.deleted, [channel.id]);
	assert.equal(await f.doc(channel), null);
});

test("simultaneous database and rollback failures log the orphan channel ID for recovery", async (f) => {
	await f.configure();
	const create = f.guild.channels.create;
	f.guild.channels.create = async (options) => { const channel = await create(options); channel.deletable = false; return channel; };
	f.TempVoiceChannel.create = fail;
	f.TempVoiceChannel.updateOne = fail;
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created.length, 1);
	assert.ok(f.errors.some((args) => args.some((value) => String(value).includes(f.created[0].channel.id))));
});

test("an ambiguous move failure never deletes a channel with occupants", async (f) => {
	await f.configure();
	f.guild.members.edit = async (id, options) => { f.setVoice(f.owner, options.channel.id ?? options.channel); fail(); };
	await f.transition(f.owner, f.creation.id);
	assert.equal(f.created.length, 1);
	assert.equal(f.deleted.length, 0);
	assert.ok(await f.doc(f.created[0].channel));
	await f.tick();
	assert.equal(f.deleted.length, 0);
});

test("only the final departure schedules deletion, and rejoining cancels it", async (f) => {
	await f.configure({ autoDeleteDelay: 1 });
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	f.setVoice(f.other, channel.id);
	await f.transition(f.owner, null);
	assert.equal((await f.doc(channel)).deleteAt, null);
	const start = Date.now();
	await f.transition(f.other, null);
	assert.ok(+(await f.doc(channel)).deleteAt >= start + 60000);
	assert.ok(+(await f.doc(channel)).deleteAt <= Date.now() + 60000);
	await f.transition(f.owner, channel.id);
	assert.equal((await f.doc(channel)).deleteAt, null);
	assert.equal(f.deleted.length, 0);
});

test("cleanup never deletes occupied expired channels, even for uncached members", async (f) => {
	await f.configure();
	const channel = await f.tracked({ deleteAt: new Date(1) });
	f.setVoice(f.other, channel.id);
	f.guild.members.cache.delete(f.other.id);
	assert.equal(channel.members.size, 0);
	await f.tick();
	assert.equal(f.deleted.length, 0);
	assert.equal((await f.doc(channel)).deleteAt, null);
});

test("cleanup reconciles unscheduled empty channels after restart and deletes only when due", async (f) => {
	await f.configure({ autoDeleteDelay: 1 });
	const channel = await f.tracked();
	await f.tick();
	const firstDeadline = +(await f.doc(channel)).deleteAt;
	assert.ok(firstDeadline > Date.now());
	await f.tick();
	assert.equal(+(await f.doc(channel)).deleteAt, firstDeadline);
	assert.equal(f.deleted.length, 0);
	await f.TempVoiceChannel.updateOne({ channelId: channel.id }, { $set: { deleteAt: new Date(1) } });
	await f.tick();
	assert.deepEqual(f.deleted, [channel.id]);
	assert.equal(await f.doc(channel), null);
});

test("zero auto-delete disables and clears previously scheduled deletion", async (f) => {
	await f.configure({ autoDeleteDelay: 0 });
	const channel = await f.tracked({ deleteAt: new Date(1) });
	await f.tick();
	assert.equal(f.deleted.length, 0);
	assert.equal((await f.doc(channel)).deleteAt, null);
	f.setVoice(f.owner, channel.id);
	await f.transition(f.owner, null);
	assert.equal((await f.doc(channel)).deleteAt, null);
});

test("cleanup still works after creation is disabled or unrelated configuration is invalid", async (f) => {
	await f.configure({ creationChannelId: null, nameTemplate: 12, autoDeleteDelay: 1 });
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	await f.transition(f.owner, null);
	assert.ok((await f.doc(channel)).deleteAt instanceof Date);
	await f.TempVoiceChannel.updateOne({ channelId: channel.id }, { $set: { deleteAt: new Date(1) } });
	await f.tick();
	assert.equal(await f.doc(channel), null);
});

for (const condition of ["not-ready", "unavailable-guild", "missing-guild", "not-deletable", "fetch-failed", "delete-failed", "not-voice"]) {
	test(`cleanup retains tracking under ${condition}`, async (f) => {
		await f.configure();
		const channel = await f.tracked({ deleteAt: new Date(1) });
		if (condition === "not-ready") f.setReady(false);
		if (condition === "unavailable-guild") f.guild.available = false;
		if (condition === "missing-guild") f.ctx.client.guilds.cache.delete(f.guild.id);
		if (condition === "not-deletable") channel.deletable = false;
		if (condition === "fetch-failed") { f.guild.channels.cache.delete(channel.id); f.guild.channels.fetch = fail; }
		if (condition === "delete-failed") channel.delete = fail;
		if (condition === "not-voice") channel.type = 0;
		await f.tick();
		assert.equal(f.deleted.length, 0);
		assert.ok(await f.doc(channel));
	});
}

test("only a confirmed missing Discord channel removes stale tracking", async (f) => {
	const channel = await f.tracked();
	f.guild.channels.cache.delete(channel.id);
	await f.tick();
	assert.equal(await f.doc(channel), null);
});

test("a member arriving while cleanup awaits the channel fetch prevents deletion", async (f) => {
	const channel = await f.tracked({ deleteAt: new Date(1) });
	f.guild.channels.cache.delete(channel.id);
	f.guild.channels.fetch = async () => { f.setVoice(f.owner, channel.id); f.guild.channels.cache.set(channel.id, channel); return channel; };
	await f.tick();
	assert.equal(f.deleted.length, 0);
	assert.equal((await f.doc(channel)).deleteAt, null);
});

test("owner lock/unlock uses Connect overwrites, defaults to voice, and restores the previous setting", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	await channel.permissionOverwrites.edit(f.guild.id, { Connect: true }, { type: 0 });
	await f.command("lock", {}, f.owner);
	assert.equal(overwrite(channel, f.guild.id, P.Connect), false);
	assert.equal((await f.doc(channel)).locked, true);
	await f.command("lock", {}, f.owner);
	await f.command("unlock", {}, f.owner);
	assert.equal(overwrite(channel, f.guild.id, P.Connect), true);
	assert.equal((await f.doc(channel)).locked, false);
	assert.equal(f.errors.length, 0);
});

test("lock:false restores inheritance rather than granting public access", async (f) => {
	const channel = await f.tracked();
	await f.command("lock", { channel }, f.owner);
	await f.command("lock", { channel, lock: false }, f.owner);
	assert.equal(overwrite(channel, f.guild.id, P.Connect), null);
});

for (const name of ownerCommands) {
	test(`${name} requires tracked, same-guild owner or moderator authority`, async (f) => {
		const channel = await f.tracked();
		const options = { channel, name: "Renamed", user: f.admin.user };
		const before = snapshot(channel);
		await f.command(name, options, f.other);
		assert.deepEqual(snapshot(channel), before);
		assert.equal(channel.name, channel.id);
		await f.command(name, { ...options, channel: f.creation }, f.owner);
		assert.equal(f.creation.permissionOverwrites.cache.size, 0);
		await f.TempVoiceChannel.updateOne({ channelId: channel.id }, { $set: { guildId: "foreign" } });
		await f.command(name, options, f.owner);
		assert.deepEqual(snapshot(channel), before);
	});
}

test("moderators can manage another owner's tracked channel", async (f) => {
	const channel = await f.tracked();
	await f.command("rename", { channel, name: "Moderator rename" });
	assert.equal(channel.name, "Moderator rename");
	await f.command("lock", { channel });
	assert.equal((await f.doc(channel)).locked, true);
});

test("rename rejects blank or oversized names, and never defaults to the text channel", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	await f.command("rename", { name: " " }, f.owner);
	await f.command("rename", { name: "a".repeat(101) }, f.owner);
	assert.equal(channel.name, channel.id);
	await f.command("rename", { name: "  My room  " }, f.owner);
	assert.equal(channel.name, "My room");
	assert.equal(f.text.name, f.text.id);
});

test("permit/deny persist unique user lists and remove contradictory entries", async (f) => {
	const channel = await f.tracked();
	const options = { channel, user: f.other.user };
	await f.command("permit", options, f.owner);
	await f.command("permit", options, f.owner);
	assert.deepEqual((await f.doc(channel)).allowedUsers, [f.other.id]);
	await f.command("deny", options, f.owner);
	assert.equal(overwrite(channel, f.other.id, P.Connect), false);
	assert.deepEqual((await f.doc(channel)).allowedUsers, []);
	assert.deepEqual((await f.doc(channel)).disallowedUsers, [f.other.id]);
	await f.command("permit", options, f.owner);
	assert.equal(overwrite(channel, f.other.id, P.Connect), true);
	assert.deepEqual((await f.doc(channel)).disallowedUsers, []);
});

test("role permits track role IDs, not a stale expansion of current members", async (f) => {
	const channel = await f.tracked();
	const role = { id: "role-1", name: "Guests", guild: f.guild, members: new Map([[f.other.id, f.other]]) };
	await f.command("permit", { channel, role }, f.owner);
	assert.deepEqual((await f.doc(channel)).allowedRoles, [role.id]);
	assert.deepEqual((await f.doc(channel)).allowedUsers, []);
	await f.command("deny", { channel, role }, f.owner);
	assert.deepEqual((await f.doc(channel)).allowedRoles, []);
	assert.deepEqual((await f.doc(channel)).disallowedRoles, [role.id]);
});

test("permission commands reject ambiguous targets, everyone, and denying the owner or bot", async (f) => {
	const channel = await f.tracked();
	const before = snapshot(channel);
	await f.command("permit", { channel }, f.owner);
	await f.command("permit", { channel, user: f.other.user, role: { id: "role-1" } }, f.owner);
	await f.command("permit", { channel, role: f.guild.roles.everyone }, f.owner);
	await f.command("deny", { channel, user: f.owner.user }, f.owner);
	await f.command("deny", { channel, user: f.bot.user }, f.owner);
	assert.deepEqual(snapshot(channel), before);
});

test("deny cannot remove bot access through a role on legacy channels", async (f) => {
	const channel = await f.tracked();
	const role = { id: "bot-role", name: "Bot role", guild: f.guild, members: new Map([[f.bot.id, f.bot]]) };
	f.bot.roles.cache.set(role.id, role);
	const before = snapshot(channel);
	await f.command("deny", { channel, role }, f.owner);
	assert.deepEqual(snapshot(channel), before);
	assert.deepEqual((await f.doc(channel)).disallowedRoles, []);
});

test("bulk permission updates require the bot's effective Manage Channels permission", async (f) => {
	const channel = await f.tracked();
	channel.botPermissions = new PermissionsBitField(PermissionsBitField.All & ~P.Administrator & ~P.ManageChannels);
	await f.command("lock", { channel }, f.owner);
	assert.equal((await f.doc(channel)).locked, false);
	assert.equal(overwrite(channel, f.guild.id, P.Connect), null);
});

test("Discord permission failure does not advance lock state", async (f) => {
	const channel = await f.tracked();
	channel.permissionOverwrites.set = fail;
	channel.permissionOverwrites.edit = fail;
	await f.command("lock", { channel }, f.owner);
	assert.equal((await f.doc(channel)).locked, false);
	assert.equal(f.errors.length, 1);
});

test("database failure restores Discord overwrites without changing persisted state", async (f) => {
	const channel = await f.tracked();
	const before = snapshot(channel);
	f.TempVoiceChannel.updateOne = fail;
	await f.command("lock", { channel }, f.owner);
	assert.deepEqual(snapshot(channel), before);
	assert.equal((await f.doc(channel)).locked, false);
	assert.equal(f.errors.length, 1);
});

test("a present member can claim after the previous owner leaves, updating both identity fields", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.other, channel.id);
	await channel.permissionOverwrites.edit("unrelated-role", { Speak: false }, { type: 0 });
	await f.command("claim", { channel }, f.other);
	const doc = await f.doc(channel);
	assert.equal(doc.creatorId, f.other.id);
	assert.equal(doc.userId, f.other.id);
	assert.ok(!channel.permissionOverwrites.cache.has(f.owner.id));
	assert.equal(overwrite(channel, f.other.id, P.Connect), true);
	assert.equal(overwrite(channel, "unrelated-role", P.Speak), false);
	await f.command("rename", { channel, name: "Claimed room" }, f.other);
	assert.equal(channel.name, "Claimed room");
});

test("claim rejects remote members and members trying to take a present owner's channel", async (f) => {
	const channel = await f.tracked();
	await f.command("claim", { channel }, f.other);
	assert.equal((await f.doc(channel)).creatorId, f.owner.id);
	f.setVoice(f.owner, channel.id);
	f.setVoice(f.other, channel.id);
	await f.command("claim", { channel }, f.other);
	assert.equal((await f.doc(channel)).creatorId, f.owner.id);
});

test("moderator claim override still requires being in the channel", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	await f.command("claim", { channel });
	assert.equal((await f.doc(channel)).creatorId, f.owner.id);
	f.setVoice(f.admin, channel.id);
	await f.command("claim", { channel });
	assert.equal((await f.doc(channel)).creatorId, f.admin.id);
});

test("self-claim is a no-op and does not revoke the current owner's overwrite", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.owner, channel.id);
	const before = snapshot(channel);
	await f.command("claim", {}, f.owner);
	assert.deepEqual(snapshot(channel), before);
});

test("concurrent claims cannot steal ownership back and forth", async (f) => {
	const channel = await f.tracked();
	const third = f.member("third-member");
	f.setVoice(f.other, channel.id);
	f.setVoice(third, channel.id);
	await Promise.all([f.command("claim", { channel }, f.other), f.command("claim", { channel }, third)]);
	assert.equal((await f.doc(channel)).creatorId, f.other.id);
	assert.equal(overwrite(channel, third.id, P.Connect), null);
});

test("claim database failure rolls back permissions and keeps the previous owner", async (f) => {
	const channel = await f.tracked();
	f.setVoice(f.other, channel.id);
	const before = snapshot(channel);
	f.TempVoiceChannel.updateOne = fail;
	await f.command("claim", { channel }, f.other);
	assert.deepEqual(snapshot(channel), before);
	assert.equal((await f.doc(channel)).creatorId, f.owner.id);
	assert.equal((await f.doc(channel)).userId, f.owner.id);
});

test("unload stops and destroys only this plugin's cron and unsubscribes its hook", async (f) => {
	const job = f.jobs[0];
	await f.hooks.emitHook("onPluginUnload", { pluginName: "another-plugin" });
	assert.equal(job.stops, 0);
	await f.close();
	assert.equal(job.stops, 1);
	assert.equal(job.destroys, 1);
	await f.close();
	assert.equal(job.stops, 1);
	await f.configure();
	await f.transition(f.owner, f.creation.id);
	await job.tick();
	assert.equal(f.created.length, 0);
	await f.reload();
	assert.equal(f.jobs.length, 2);
	await f.transition(f.other, f.creation.id);
	assert.equal(f.created.length, 1, "old event closure is inert after reload");
});

test("unload waits for in-flight creation to roll back without moving the member", async (f) => {
	await f.configure();
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	let started = false;
	const create = f.guild.channels.create;
	f.guild.channels.create = async (options) => { started = true; await gate; return create(options); };
	const joining = f.transition(f.owner, f.creation.id);
	try {
		await until(() => started);
		const closing = f.close();
		release();
		await Promise.all([joining, closing]);
		assert.equal(f.moves.length, 0);
		assert.equal(f.deleted.length, 1);
		assert.equal(await f.TempVoiceChannel.countDocuments(), 0);
	} finally {
		release();
		await joining;
	}
});

test("overlapping cleanup ticks do not delete the same channel twice", async (f) => {
	const channel = await f.tracked({ deleteAt: new Date(1) });
	await Promise.all([f.tick(), f.tick()]);
	assert.deepEqual(f.deleted, [channel.id]);
	assert.equal(await f.doc(channel), null);
});

async function main() {
	let passed = 0;
	let failed = 0;
	for (const { name, run } of tests) {
		let f;
		try {
			f = await fixture();
			await run(f);
			passed++;
			console.log(`PASS ${name}`);
		} catch (error) {
			failed++;
			console.error(`FAIL ${name}\n${error.stack}`);
		} finally {
			if (f) await f.close();
		}
	}
	console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
	process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
