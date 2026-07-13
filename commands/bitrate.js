"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("bitrate")
 .setDescription("Set the bitrate for new temporary voice channels")
 .addIntegerOption((option) =>
 option
 .setName("bitrate")
 .setDescription("Bitrate in bps (max 384000 for non-vip servers)")
 .setMinValue(8000)
 .setMaxValue(384000)
 .setRequired(true)
 )
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

 async execute(interaction, ctx) {
 if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
 return interaction.reply({
 content: "You need the **Manage Channels** permission to use this command.",
 ephemeral: true,
 });
 }

 const guildId = interaction.guild.id;
 const bitrate = interaction.options.getInteger("bitrate");

 // Update config
 let config = (await ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice"))?.data || {};
 config.bitrateDefault = bitrate;

 await ctx.db.updatePluginConfig(guildId, "adb-plugin-tempvoice", config);

 await interaction.reply({
 content: `✅ New temporary voice channels will now have a bitrate of **${bitrate} bps**.`,
 ephemeral: true,
 });
 },
};
