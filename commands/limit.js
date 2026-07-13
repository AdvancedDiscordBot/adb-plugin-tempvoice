"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("limit")
 .setDescription("Set the user limit for new temporary voice channels")
 .addIntegerOption((option) =>
 option
 .setName("limit")
 .setDescription("User limit (0 = no limit)")
 .setMinValue(0)
 .setMaxValue(99)
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
 const userLimit = interaction.options.getInteger("limit");

 // Fetch or create config
 let config = (await ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice"))?.data || {};
 config.userLimitDefault = userLimit;

 // Update
 await ctx.db.updatePluginConfig(guildId, "adb-plugin-tempvoice", config);

 await interaction.reply({
 content: `✅ New temporary voice channels will now have a user limit of **${userLimit}**.`,
 ephemeral: true,
 });
 },
};
