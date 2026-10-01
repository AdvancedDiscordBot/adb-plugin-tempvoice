"use strict";

const { PermissionOverwrites, PermissionsBitField } = require("discord.js");

const OWNER_PERMISSIONS = { ViewChannel: true, Connect: true, Speak: true };

async function fetchChannel(guild, id) {
	try {
		const channel = await guild.channels.fetch(id);
		if (channel && channel.guild.id !== guild.id) throw new Error("Channel belongs to a different guild.");
		return channel;
	} catch (error) {
		if (error.code === 10003) return null; // Discord: Unknown Channel, not a cache miss or permission failure.
		throw error;
	}
}

function hasOccupants(channel) {
	return channel.members.size > 0 ||
		channel.guild.voiceStates.cache.some((state) => state.channelId === channel.id);
}

function copyOverwrites(channel) {
	return [...channel.permissionOverwrites.cache.values()].map((entry) => ({
		id: entry.id, type: entry.type, allow: entry.allow.bitfield, deny: entry.deny.bitfield,
	}));
}

function setOverwrite(overwrites, id, type, permissions) {
	const previous = overwrites.find((entry) => entry.id === id);
	const { allow, deny } = PermissionOverwrites.resolveOverwriteOptions(permissions, previous && {
		allow: new PermissionsBitField(previous.allow), deny: new PermissionsBitField(previous.deny),
	});
	return [
		...overwrites.filter((entry) => entry.id !== id),
		{ id, type, allow: allow.bitfield, deny: deny.bitfield },
	];
}

module.exports = { OWNER_PERMISSIONS, fetchChannel, hasOccupants, copyOverwrites, setOverwrite };
