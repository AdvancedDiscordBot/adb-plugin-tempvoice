"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("unlock")
 .setDescription("Unlock a temporary voice channel")
 .addChannelOption((option) =>
 option
 .setName("channel")
 .setDescription("The temporary voice channel to unlock")
 .addChannelTypes(2) // voice
 .setRequired(true)
 )
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

 async execute(interaction, ctx) {
 const guildId = interaction.guild.id;
 const channel = interaction.options.getChannel("channel");

 // Check that this channel is a tracked temp voice channel
 const TempVoiceChannel = ctx.models.get("plugin_adb-plugin-tempvoice_TempVoiceChannel");
 const channelDoc = await TempVoiceChannel.findOne({ channelId: channel.id });
 if (!channelDoc) {
 return interaction.reply({
 content: "❌ This channel is not a temporary voice channel.",
 ephemeral: true,
 });
 }

 // You can only unlock a channel you created or a team member (admins can override)
 if (
 interaction.user.id !== channelDoc.creatorId &&
 !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
 ) {
 return interaction.reply({
 content: "❌ Only the channel creator or a **Manage Channels** user can unlock this channel.",
 ephemeral: true,
 });
 }

 // Update DB and Discord
 try {
 // Simulate unlock: just reset permissions as needed
 const guild = interaction.guild;
 await channel.permissionOverwrites.edit(guild.roles.everyone, {
 Connect: null, // inherit from category? Alternatively, explicitly allow?
 });

 // Update DB
 channelDoc.locked = false;
 await channelDoc.save();

 await interaction.reply({
 content: `🔓 Unlocked channel **${channel.name}**.
Anyone can join it again.`,
 ephemeral: true,
 });
 } catch (err) {
 console.error("Failed to unlock channel:", err);
 await interaction.reply({
 content: "❌ Failed to unlock channel.",
 ephemeral: true,
 });
 }
 },
};
