"use strict";

const { Schema } = require("mongoose");

/**
 * Legacy per-guild configuration, retained only for importing existing data.
 * New configuration lives in the dashboard's PluginConfig.data document.
 */
module.exports = new Schema({
	// Discord guild ID (snowflake)
	guildId: {
		type: String,
		required: true,
		unique: true,
		index: true
	},

	// Channel where temp channels are spawned
	creationChannelId: {
		type: String,
		required: true,
		default: null
	},

	// Category where temp channels live
	categoryId: {
		type: String,
		required: true,
		default: null
	},

	// Template for channel names: {user} -> mention, {username} -> plain
	nameTemplate: {
		type: String,
		default: "{username}'s channel"
	},

	// Auto-delete delay in minutes (0 = disabled)
	autoDeleteDelay: {
		type: Number,
		default: 10,
		min: 0
	},

	// Maximum number of temp channels allowed per guild (0 = unlimited)
	maxChannels: {
		type: Number,
		default: 0
	},

	// Default bitrate for new channels (bps)
	bitrateDefault: {
		type: Number,
		default: 64000,
		min: 8000,
		max: 384000
	},

	// Default user limit for new channels (0 = no limit)
	userLimitDefault: {
		type: Number,
		default: 0,
		min: 0,
		max: 99
	},

	// User who set up this config (ownership claim)
	creatorId: {
		type: String,
		index: true
	},

	// Timestamps for createdAt/updatedAt
	createdAt: {
		type: Date,
		default: Date.now
	},
	updatedAt: {
		type: Date,
		default: Date.now
	}
}, {
	timestamps: {
		createdAt: "createdAt",
		updatedAt: "updatedAt"
	}
});
