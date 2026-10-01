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

	// Current owner (also updated when the channel is claimed)
	creatorId: {
		type: String,
		required: true,
		index: true
	},

	// Same value as creatorId; duplicated so the platform's member-scope
	// query ({guildId, userId}) can find a member's own channels.
	userId: {
		type: String,
		default: null,
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

	// Only empty channels have a deadline. Mongo must not TTL-delete tracking rows.
	deleteAt: {
		type: Date,
		default: null,
		index: true
	},
	pendingCleanup: {
		type: Boolean,
		default: false
	},

	// Preserve @everyone's Connect setting across lock/unlock.
	locked: {
		type: Boolean,
		default: false
	},
	previousConnect: {
		type: Boolean,
		default: null
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
	allowedRoles: [{
		type: String
	}],
	disallowedRoles: [{
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
	}
});
