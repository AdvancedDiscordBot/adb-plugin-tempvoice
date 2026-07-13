"use strict";

const { Schema } = require("mongoose");

/**
 * Temporary voice channel state.
 * Tracks lifecycle, permissions, and cleanup timers.
 */
module.exports = new Schema({
	// Discord guild ID (snowflake)
	guildId: {
		type: String,
		required: true,
		index: true
	},

	// Voice channel ID (snowflake)
	channelId: {
		type: String,
		required: true,
		unique: true,
		index: true
	},

	// User who created this channel
	creatorId: {
		type: String,
		required: true,
		index: true
	},

	// Timestamp of creation
	createdAt: {
		type: Date,
		default: Date.now,
		index: true
	},

	// node-cron job ID for cleanup
	cleanupJobId: {
		type: String,
		default: null
	},

	// Lock status (prevent invite spam)
	locked: {
		type: Boolean,
		default: false
	},

	// Current user limit (discord max 99)
	userLimit: {
		type: Number,
		default: 0,
		min: 0,
		max: 99
	},

	// Current bitrate (discord range 8000-384000 bps)
	bitrate: {
		type: Number,
		default: 64000,
		min: 8000,
		max: 384000
	},

	// Users allowed (whitelist)
	allowedUsers: [{
		type: String
	}],

	// Users blocked (blacklist)
	disallowedUsers: [{
		type: String
	}],

	// Last time someone joined (used for idle timeout)
	lastActiveAt: {
		type: Date,
		default: Date.now
	}
}, {
	timestamps: {
		createdAt: "createdAt",
		updatedAt: "lastActiveAt"
	},
	// TTL index for auto-cleanup (fallback)
	index: {
		lastActiveAt: 1,
		expireAfterSeconds: 60 * 60 * 24 * 7 // 7 days idle max
	}
});