// Run with: npm test (or) node test/local-harness.js
// Loads the plugin against a bot-faithful mock ctx (test/mock-ctx.js), then
// simulates a member joining the creation channel and asserts the stored doc
// carries BOTH creatorId and userId (platform member pages query
// {guildId, userId} — see /me/channels in plugin.json webUi.memberPages).

"use strict";

const assert = require("node:assert");
const nodeCron = require("node-cron");
const { load } = require("../index");
const { createMockCtx } = require("./mock-ctx");

async function main() {
	// Stub cron registration so the 30s cleanup job doesn't keep the process alive.
	const originalSchedule = nodeCron.schedule;
	nodeCron.schedule = () => ({ stop: () => {} });

	const { ctx, models, emitEvent } = createMockCtx({
		pluginName: "adb-plugin-tempvoice",
	});

	await load(ctx);
	nodeCron.schedule = originalSchedule;

	const guildId = "test-guild";
	const creatorId = "creator-42";

	const TempVoiceConfig = models.get("plugin_adb-plugin-tempvoice_TempVoiceConfig");
	const TempVoiceChannel = models.get("plugin_adb-plugin-tempvoice_TempVoiceChannel");

	// Per-guild config: enable join-to-create.
	await TempVoiceConfig.create({
		guildId,
		creationChannelId: "create-channel",
		nameTemplate: "{username}'s room",
		autoDeleteDelay: 30,
		bitrateDefault: 64000,
		userLimitDefault: 0,
	});

	// Fake guild backing the voiceStateUpdate handler (channel creation + member fetch).
	ctx.client.guilds.cache.set(guildId, {
		id: guildId,
		members: {
			fetch: async (id) => ({ id, user: { id, username: "tester" } }),
		},
		channels: {
			create: async (name) => ({
				id: "new-voice-1",
				name,
				permissionOverwrites: { edit: async () => {} },
			}),
			cache: new Map(),
		},
	});

	// Member joins the creation channel -> plugin creates a temp channel + doc.
	await emitEvent("voiceStateUpdate", { channelId: null }, {
		channelId: "create-channel",
		guildId,
		member: { id: creatorId, user: { id: creatorId, username: "tester" } },
	});

	// Member-scope identity: BOTH creatorId and userId must equal the creator.
	const doc = await TempVoiceChannel.findOne({ channelId: "new-voice-1" });
	assert.ok(doc, "temp channel doc was created on join");
	assert.strictEqual(doc.creatorId, creatorId, "doc.creatorId === creator ID");
	assert.strictEqual(doc.userId, creatorId, "doc.userId === creator ID");

	console.log("OK: all local-harness checks passed");
}

main().catch((err) => {
	console.error("Local harness failed:", err);
	process.exit(1);
});
