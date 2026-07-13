"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("permit")
 .setDescription("Permit a user or role to join your temporary voice channel")
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
 .setDescription("The user to permit")
 .setRequired(false)
 )
 .addRoleOption((option) =>
 option
 .setName("role")
 .setDescription("The role to permit")
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

 // Check if they own the channel
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
 content: "❌ You can only permit users for your own temporary channels.",
 ephemeral: true,
 });
 }

 try {
 if (user) {
 await channel.permissionOverwrites.edit(user.id, {
 Connect: true,
 ViewChannel: true,
 })
 }
 if (role) {
 await channel.permissionOverwrites.edit(role.id, {
 Connect: true,
 ViewChannel: true,
 })
 }

 // Persist to DB: allowed_users for documentation
 const allowedUsers = channelDoc.allowedUsers || [];
 if (user) allowedUsers.push(user.id);
 if (role) {
 for (const member of role.members.values()) {
 if (!allowedUsers.includes(member.id)) {
 allowedUsers.push(member.id);
 }
 }
 }
 channelDoc.allowedUsers = allowedUsers;
 await channelDoc.save();

 await interaction.reply({
 content: `✅ **${user ? user.tag : role.name}** can now join **${channel.name}**.`,
 ephemeral: true,
 });
 } catch (err) {
 console.error("Failed to permit user/role:", err);
 await interaction.reply({
 content: "❌ Failed to update permissions.",
 ephemeral: true,
 });
 }
 },
};
