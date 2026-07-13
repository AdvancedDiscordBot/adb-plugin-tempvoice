"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock/unlock a temporary voice channel (prevent users from leaving)")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to lock/unlock (defaults to current voice channel)")
        .setRequired(false)
        .addChannelTypes(2) // Voice channel type
    )
    .addBooleanOption((option) =>
      option
        .setName("lock")
        .setDescription("Lock the channel (true) or unlock it (false)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: "You need the **Manage Channels** permission to use this command.",
        ephemeral: true,
      });
    }

    const targetChannel = interaction.options.getChannel("channel") || interaction.channel;
    const lock = interaction.options.getBoolean("lock");

    // Validate target is a voice channel
    if (targetChannel.type !== 2) {
      return interaction.reply({
        content: "The specified channel must be a **voice channel**.",
        ephemeral: true,
      });
    }

    // If lock status not specified, toggle it
    const shouldLock = lock !== null ? lock : !targetChannel.locked;

    try {
      await targetChannel.setLocked(shouldLock);
    } catch (err) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(`Failed to ${shouldLock ? "lock" : "unlock"} channel: ${err.message}`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const action = shouldLock ? "🔒 Locked" : "🔓 Unlocked";
    const description = shouldLock
      ? "Users can no longer leave this channel."
      : "Users can now leave this channel.";

    const embed = new EmbedBuilder()
      .setColor(shouldLock ? 0xe74c3c : 0x2ecc71)
      .setTitle(`${action} — ${targetChannel.name}`)
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
