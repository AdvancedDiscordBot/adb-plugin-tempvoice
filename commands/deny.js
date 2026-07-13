"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("deny")
 .setDescription("Deny a user or role from joining your temporary voice channel")
 .addChannelOption((option) =>
 option
 .setName("channel")
 .setDescription("Your temporary voice channel")
 .addChannelTypes(2) // voice
 .setRequired(true)
 )
 .addUserOption((option) =>
 option
 .setName("user")
 .setDescription("The user to deny")
 .setRequired(false)
 )
 .addRoleOption((option) =>
 option
 .setName("role")
 .setDescription("The role to deny")
 .setRequired(false)
 )
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

 async execute(interaction, ctx) {
 const guildId = interaction.guild.id;
 const channel = interaction.options.getChannel("channel");
 const user = interaction.options.getUser("user") || null;
 const role = interaction.options.getRole("role") || null;

 if (!user && !role) {
 return interaction.reply({
 content: "❌ Specify either a **user** or **role**.",
 ephemeral: true,
 });
 }

 // Check they own the channel
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
 content: "❌ You can only deny users for your own temporary channels.",
 ephemeral: true,
 });
 }

 try {
 if (user) {
 await channel.permissionOverwrites.edit(user.id, {
 Connect: false,
 ViewChannel: false,
 })
 }
 if (role) {
 await channel.permissionOverwrites.edit(role.id, {
 Connect: false,
 ViewChannel: false,
 })
 }

 await interaction.reply({
 content: `❌ **${user ? user.tag : role.name}** is no longer permitted to join **${channel.name}**.`,
 ephemeral: true,
 });
 } catch (err) {
 console.error("Failed to deny user/role:", err);
 await interaction.reply({
 content: "❌ Failed to update permissions.",
 ephemeral: true,
 });
 }
 },
};
