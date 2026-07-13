"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("name")
    .setDescription("Update the name template for temporary voice channels")
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("New name template (use {username} or {user})")
        .setRequired(true)
        .setMaxLength(100)
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
    const template = interaction.options.getString("template");

    // Validate template format
    if (!template.includes("{username}") && !template.includes("{user}")) {
      return interaction.reply({
        content: "The template must include **{username}** or **{user}** as a placeholder.",
        ephemeral: true,
      });
    }

    // Fetch and update config
    let config = (await ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice"))?.data || {};

    config.nameTemplate = template;

    // Persist config
    await ctx.db.updatePluginConfig(guildId, "adb-plugin-tempvoice", config);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Name Template Updated")
      .setDescription("Your temporary voice channel name template has been updated.")
      .addFields(
        { name: "New Template", value: `\`${template}\``, inline: false },
        { name: "Placeholders", value: "**{username}** — plain username\n**{user}** — user mention", inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
