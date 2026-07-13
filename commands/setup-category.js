"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
 data: new SlashCommandBuilder()
 .setName("setup-category")
 .setDescription("Set or change the category where temporary voice channels are created")
 .addChannelOption((option) =>
 option
 .setName("category")
 .setDescription("The category where temp channels will be placed")
 .setRequired(true)
 .addChannelTypes(15) // Category type
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
 const category = interaction.options.getChannel("category");

 // Validate category
 if (category.type !== 15) {
 return interaction.reply({
 content: "The **category** must be a **category channel**.",
 ephemeral: true,
 });
 }

 // Fetch or create config
 let config = (await ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice"))?.data || {};
 config.categoryId = category.id;

 // Persist
 await ctx.db.updatePluginConfig(guildId, "adb-plugin-tempvoice", config);

 await interaction.reply({
 content: `✅ Temporary voice channels will now be created in **${category.name}**.`,
 ephemeral: true,
 });
 },
};
