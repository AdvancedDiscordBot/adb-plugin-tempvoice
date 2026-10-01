"use strict";

const { name: PLUGIN_NAME, configSchema } = require("../plugin.json");
const DEFAULT_CONFIG = Object.fromEntries(
	Object.entries(configSchema.properties).map(([key, property]) => [key, property.default]),
);

async function readConfig(db, LegacyConfig, guildId) {
	const data = (await db.getPluginConfig(guildId, PLUGIN_NAME))?.data || {};
	// Older installations could persist the separate model. Never override an
	// explicit dashboard setting (including a null creation channel) with it.
	if (!Object.keys(DEFAULT_CONFIG).some((key) => Object.hasOwn(data, key))) {
		const legacy = await LegacyConfig.findOne({ guildId }).lean();
		if (legacy) {
			const imported = {};
			for (const key of [...Object.keys(DEFAULT_CONFIG), "creatorId"]) {
				if (legacy[key] !== undefined) imported[key] = legacy[key];
			}
			const config = { ...DEFAULT_CONFIG, ...imported, ...data };
			await db.updatePluginConfig(guildId, PLUGIN_NAME, config);
			return config;
		}
	}
	return { ...DEFAULT_CONFIG, ...data };
}

function validDeleteDelay(value) {
	return Number.isSafeInteger(value) && value >= 0 &&
		Number.isFinite(new Date(Date.now() + value * 60000).getTime());
}

function validateConfig(config, maximumBitrate = 384000) {
	for (const key of ["creationChannelId", "categoryId"]) {
		if (config[key] !== null && (typeof config[key] !== "string" || !config[key].trim())) {
			return `${key} must be a channel ID or null.`;
		}
	}
	if (typeof config.nameTemplate !== "string" || !config.nameTemplate.trim() ||
		config.nameTemplate.length > 100 || !/\{(?:username|user)\}/.test(config.nameTemplate)) {
		return "The name template must be 1-100 characters and include {username} or {user}.";
	}
	if (!validDeleteDelay(config.autoDeleteDelay)) {
		return "The auto-delete delay must be a non-negative whole number of minutes within the supported date range (0 = disabled).";
	}
	if (!Number.isSafeInteger(config.maxChannels) || config.maxChannels < 0) {
		return "The maximum channel count must be a non-negative whole number (0 = unlimited).";
	}
	if (!Number.isInteger(config.userLimitDefault) || config.userLimitDefault < 0 || config.userLimitDefault > 99) {
		return "The user limit must be a whole number from 0 to 99.";
	}
	const bitrateLimit = Math.min(384000, maximumBitrate);
	if (!Number.isInteger(config.bitrateDefault) || config.bitrateDefault < 8000 || config.bitrateDefault > bitrateLimit) {
		return `The bitrate must be a whole number from 8000 to ${bitrateLimit} bps for this server.`;
	}
	return null;
}

module.exports = { PLUGIN_NAME, readConfig, validateConfig, validDeleteDelay };
