"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("claim")
 .setDescription("Claim ownership of a temporary voice channel")
 .addChannelOption((option) =>
 option
 .setName("channel")
 .setDescription("The temporary voice channel to claim")
 .addChannelTypes(2) // voice
 .setRequired(true)
 )
 .setDefaultMemberPermissions(null), // anyone can claim if channel has no creator

 async execute(interaction, ctx) {
 const guildId = interaction.guild.id;
 const channel = interaction.options.getChannel("channel");

 const TempVoiceChannel = ctx.models.get("plugin_adb-plugin-tempvoice_TempVoiceChannel");
 const channelDoc = await TempVoiceChannel.findOne({ channelId: channel.id, guildId });

 if (!channelDoc) {
 return interaction.reply({
 content: "❌ This channel is not a temporary voice channel.",
 ephemeral: true,
 });
 }

 // If channel has an owner and user is not them or without ManageChannels, deny.
 if (channelDoc.creatorId && interaction.user.id !== channelDoc.creatorId && !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
 return interaction.reply({
 content: "❌ Only a server admin (**Manage Channels**) can claim a channel that still has an owner.",
 ephemeral: true,
 });
 }

 // Update DB: change owner to current user.
 channelDoc.creatorId = interaction.user.id;
 await channelDoc.save();

 // Update channel permissions: grant current user full permissions.
 await channel.permissionOverwrites.edit(interaction.user.id, {
 Connect: true,
 Speak: true,
 ViewChannel: true,
 });

 // Remove permissions from the old owner, if they weren't the current user.
 if (channelDoc.creatorId && channel.creatorId !== interaction.user.id) {
 await channel.permissionOverwrites.delete(channelDoc.creatorId);
 }

 await interaction.reply({
 content: `👑 Claimed channel **${channel.name}**. You can now manage its settings.`,
 ephemeral: true,
 });
 }
};
