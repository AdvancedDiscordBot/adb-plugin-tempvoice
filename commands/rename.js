"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("rename")
 .setDescription("Rename your temporary voice channel")
 .addChannelOption((option) =>
 option
 .setName("channel")
 .setDescription("Your temporary voice channel")
 .addChannelTypes(2) // voice
 .setRequired(true)
 )
 .addStringOption((option) =>
 option
 .setName("name")
 .setDescription("New channel name")
 .setRequired(true)
 .setMaxLength(100)
 )
 .setDefaultMemberPermissions(null), // creator allowed

 async execute(interaction, ctx) {
 const guildId = interaction.guild.id;
 const channel = interaction.options.getChannel("channel");
 const newName = interaction.options.getString("name");

 const TempVoiceChannel = ctx.models.get("plugin_adb-plugin-tempvoice_TempVoiceChannel");
 const channelDoc = await TempVoiceChannel.findOne({ channelId: channel.id, guildId });

 if (!channelDoc) {
 return interaction.reply({
 content: "❌ This channel is not a temporary voice channel.",
 ephemeral: true,
 });
 }

 if (
 interaction.user.id !== channelDoc.creatorId &&
 !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
 ) {
 return interaction.reply({
 content: "❌ You can only rename your own temporary voice channels.",
 ephemeral: true,
 });
 }

 try {
 await channel.setName(newName);
 await interaction.reply({
 content: `✅ Renamed channel: **${newName}**`,
 ephemeral: true,
 });
 } catch (err) {
 console.error("Failed to rename channel:", err);
 await interaction.reply({
 content: "❌ Failed to rename channel.",
 ephemeral: true,
 });
 }
 },
};
