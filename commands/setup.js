"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure temporary voice channel settings")
    .addChannelOption((option) =>
      option
        .setName("creation-channel")
        .setDescription("Channel where temp channels are created (must be a voice channel)")
        .setRequired(false)
        .addChannelTypes(2) // Voice channel type
    )
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription("Category where temp channels will be placed")
        .setRequired(false)
        .addChannelTypes(15) // Category type
    )
    .addStringOption((option) =>
      option
        .setName("name-template")
        .setDescription("Template for channel names (use {username} or {user})")
        .setRequired(false)
        .setMaxLength(100)
    )
    .addIntegerOption((option) =>
      option
        .setName("auto-delete-minutes")
        .setDescription("Auto-delete delay in minutes (0 = disabled)")
        .setRequired(false)
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("max-channels")
        .setDescription("Maximum temp channels allowed (0 = unlimited)")
        .setRequired(false)
        .setMinValue(0)
    )
    .addIntegerOption((option) =>
      option
        .setName("bitrate")
        .setDescription("Default bitrate for new channels in bps")
        .setRequired(false)
        .setMinValue(8000)
        .setMaxValue(384000)
    )
    .addIntegerOption((option) =>
      option
        .setName("user-limit")
        .setDescription("Default user limit for new channels (0 = no limit)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(99)
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
    const creationChannel = interaction.options.getChannel("creation-channel");
    const category = interaction.options.getChannel("category");
    const nameTemplate = interaction.options.getString("name-template");
    const autoDeleteMinutes = interaction.options.getInteger("auto-delete-minutes");
    const maxChannels = interaction.options.getInteger("max-channels");
    const bitrate = interaction.options.getInteger("bitrate");
    const userLimit = interaction.options.getInteger("user-limit");

    // Fetch existing config
    let config = (await ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice"))?.data || {};

    // Validate inputs
    if (creationChannel) {
      if (creationChannel.type !== 2) {
        return interaction.reply({
          content: "The **creation channel** must be a **voice channel**.",
          ephemeral: true,
        });
      }
      config.creationChannelId = creationChannel.id;
    }

    if (category) {
      if (category.type !== 15) {
        return interaction.reply({
          content: "The **category** must be a **category** channel.",
          ephemeral: true,
        });
      }
      config.categoryId = category.id;
    }

    if (nameTemplate) {
      config.nameTemplate = nameTemplate;
    }

    if (autoDeleteMinutes !== null) {
      config.autoDeleteDelay = autoDeleteMinutes;
    }

    if (maxChannels !== null) {
      config.maxChannels = maxChannels;
    }

    if (bitrate !== null) {
      config.bitrateDefault = bitrate;
    }

    if (userLimit !== null) {
      config.userLimitDefault = userLimit;
    }

    // Set creator if not set
    if (!config.creatorId) {
      config.creatorId = interaction.user.id;
    }

    // Persist config
    await ctx.db.updatePluginConfig(guildId, "adb-plugin-tempvoice", config);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Temporary Voice Setup Updated")
      .setDescription("Your temporary voice channel settings have been updated.")
      .addFields(
        creationChannel
          ? { name: "Creation Channel", value: `<#${creationChannel.id}>`, inline: true }
          : null,
        category ? { name: "Category", value: `<#${category.id}>`, inline: true } : null,
        nameTemplate ? { name: "Name Template", value: `\`${nameTemplate}\``, inline: true } : null,
        autoDeleteMinutes !== null ? { name: "Auto-Delete (min)", value: `${autoDeleteMinutes}`, inline: true } : null,
        maxChannels !== null ? { name: "Max Channels", value: `${maxChannels}`, inline: true } : null,
        bitrate !== null ? { name: "Default Bitrate", value: `${bitrate} bps`, inline: true } : null,
        userLimit !== null ? { name: "Default User Limit", value: `${userLimit}`, inline: true } : null
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
