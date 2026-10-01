# ADB Temp Voice Channels

Join a designated voice channel to create a temporary room and move into it.
Room owners can manage access, rename their room, or claim an abandoned room
using `/voice`. Empty rooms are deleted after a configurable delay.

An external plugin for [Advanced Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot).

## Setup

1. Install `adb-plugin-tempvoice` in your ADB installation and enable the plugin.
2. Grant the bot the permissions below and ensure ADB uses the `Guilds` and
   `GuildVoiceStates` gateway intents.
3. Run `/voice setup creation-channel:<voice channel> category:<category>` as a
   member with **Manage Channels**. A category is optional; without one, rooms
   are created at the server root.
4. Join the configured creation channel. The bot creates a room, records its
   owner, and moves that member into it.

The plugin retains its existing `system:raw-client` declaration. It uses the
raw Discord.js v14 guild/voice APIs and its own `node-cron` task; it does not
require broader permissions or isolation changes for any other plugin.

## Command Migration

**Interface change:** the old standalone commands are now subcommands of
`/voice`. No global aliases are registered, so tempvoice no longer competes with
moderation's `/lock` and `/unlock` or other plugins' generic command names.

| Previous Command | Replacement | Access and Behavior |
| --- | --- | --- |
| `/setup` | `/voice setup` | Manage Channels; view settings or update supplied defaults |
| `/setup-category` | `/voice setup-category category:<category>` | Manage Channels; category for new rooms |
| `/name` | `/voice name template:<template>` | Manage Channels; naming template for new rooms |
| `/limit` | `/voice limit limit:<0-99>` | Manage Channels; user limit for new rooms |
| `/bitrate` | `/voice bitrate bitrate:<bps>` | Manage Channels; bitrate for new rooms |
| `/lock` | `/voice lock [channel] [lock]` | Owner or Manage Channels; deny @everyone Connect |
| `/unlock` | `/voice unlock [channel]` | Owner or Manage Channels; restore the previous Connect setting |
| `/rename` | `/voice rename name:<name> [channel]` | Owner or Manage Channels; rename an existing room |
| `/permit` | `/voice permit user:<user> [channel]` or `role:<role>` | Owner or Manage Channels; allow future access |
| `/deny` | `/voice deny user:<user> [channel]` or `role:<role>` | Owner or Manage Channels; deny future access |
| `/claim` | `/voice claim [channel]` | A member currently in the room; the previous owner must be absent unless the claimant has Manage Channels |

All room controls default to the caller's **current voice channel**, never the
text channel where the command was invoked. They only operate on tracked rooms
in the interaction's guild. Ordinary owners do not need Manage Channels.

`name`, `limit`, and `bitrate` retain their original server-default semantics;
they do not edit the caller's current room. Use `rename` to rename a room.
`lock` now defaults to **lock**, not toggle; repeated calls are idempotent.
`lock:false` is equivalent to `unlock`. Locking blocks joins, not departures,
and preserves explicit member/role permits and Discord administrator bypasses.
Unlocking restores the prior @everyone Connect override, not universal access.

Permit and deny require **exactly one** user or role. Roles remain role
overwrites, not snapshots of their members. Deny cannot target the owner, the
bot, a role held by the bot, or @everyone. It does not kick existing occupants.
Discord's normal overwrite precedence still applies, including explicit member
allows taking precedence over role denies.

Claiming transfers both `creatorId` and the member-dashboard `userId`, grants
the new owner's View Channel/Connect/Speak access, and removes the previous
owner's member overwrite. Self-claim is a no-op. Manage Channels users can
override a present owner, but must also be in the room.

When upgrading from the previous implementation, restart ADB once so its
cached Mongoose models pick up the new lifecycle fields, then redeploy slash
commands using ADB's normal command deployment process. Review any custom
dashboard command policy for the new `/voice` root; old standalone command
policies are not automatically translated. No deployment is performed by the
local test harness.

## Configuration

Slash commands, voice events, and cleanup all read the same
`ctx.db.getPluginConfig(guildId, "adb-plugin-tempvoice").data` used by the
dashboard. Updates preserve unrelated fields, including reserved `_commands`
settings. Configuration and channel models are injected from `load(ctx)`;
commands never assume the bot passes a plugin context as their second argument.

| Setting | Default | Validation |
| --- | --- | --- |
| `creationChannelId` | `null` | Voice channel (type 2) in this guild; `null` disables new creation |
| `categoryId` | `null` | Category (type 4) in this guild; `null` selects the server root |
| `nameTemplate` | `{username}'s channel` | 1-100 characters containing `{username}` or `{user}` |
| `autoDeleteDelay` | `30` | Whole minutes, non-negative and within the supported date range; **0 disables auto-delete** |
| `maxChannels` | `0` | Non-negative safe integer; 0 removes the plugin limit, not Discord's guild limits |
| `bitrateDefault` | `64000` | Whole bps, 8000-384000; commands reject values above the current guild tier |
| `userLimitDefault` | `0` | Integer from 0 to 99; 0 means unlimited |

`/voice setup` accepts `creation-channel`, `category`, `name-template`,
`auto-delete-minutes`, `max-channels`, `bitrate`, and `user-limit`. Omitted
options keep existing values. With no options it displays the current settings.
Dashboard values are also validated before creation; invalid settings or
missing/wrong-type channels fail closed rather than creating rooms elsewhere.
Valid saved bitrates are capped to the guild's current maximum when creating
a room, so a later boost-tier downgrade does not break creation.

`{username}` renders the plain username. `{user}` now renders the member's
display name, rather than a literal mention (voice channel names do not render
mentions). Substitutions are literal; the final name is trimmed and capped at
100 characters.

For installations with persisted `TempVoiceConfig` rows, settings are imported
into `PluginConfig.data` on first use **only if no tempvoice settings already
exist there**. Reserved or unrelated fields alone do not prevent import.
Existing values, including the legacy 10-minute deletion default, are retained.
Canonical settings always win, including an explicitly disabled creation
channel. The legacy collection is not deleted or used for new writes.

## Permissions

The bot needs **View Channel, Connect, Speak, Move Members, Manage Channels,
Manage Roles**, and **Send Messages**. Effective channel/category overwrites
must allow these operations as well. Manage Roles is needed for access
overwrites, not for handing out server roles.

Creation checks the source and destination permissions before creating a room.
Category overwrites are copied, and member-specific View Channel/Connect/Speak
access is granted to the creator and bot. Owners are **not** granted Discord
Manage Channels; the plugin authorizes their `/voice` operations itself.

## Lifecycle and Recovery

- Successful creation is tracked before moving the creator, with no deletion
  deadline while occupied. Bots, mute/deafen updates, stale joins, and duplicate
  concurrent join events do not create extra rooms.
- A per-guild queue serializes creation, commands, and cleanup so concurrent
  joins cannot bypass `maxChannels` and concurrent claims see the latest owner.
- The last departure starts the deletion delay. A rejoin clears it. Changing
  the delay applies to the next empty period; setting it to 0 also cancels
  pending normal deletion on the next reconciliation.
- A 30-second task reconciles tracked rooms after restart, starts missing
  empty-room deadlines, and deletes expired rooms only if still empty and
  deletable. It checks voice states as well as cached members, and skips
  unavailable guilds or a disconnected client.
- A missing guild, cache miss, or Discord permission/network error does not
  discard tracking. A confirmed missing Discord channel does. Cleanup continues
  for existing rooms after join-to-create is disabled.
- Create, tracking, or move failures roll back empty created rooms. If deletion
  cannot complete or the room has occupants, a pending-cleanup row is retained
  or created for safe retry once empty, even when normal auto-delete is disabled.
  If both Discord rollback and database persistence fail, the error log includes
  the channel ID for manual recovery.
- Permission/ownership changes restore the prior Discord overwrites if database
  persistence fails. Failed compensation is logged; no success is reported.
- Unload stops and destroys this plugin's cron, removes its unload hook, rejects
  new work, and waits for in-flight guild operations. In-flight creation is
  rolled back if unload happens before the move.

Deletion deadlines are persisted in the channel schema; there is no Mongo TTL
that could silently remove tracking while leaving a Discord channel behind.

## Local Tests

```bash
npm install
npm test
```

The harness loads the public `load(ctx)` entrypoint with a frozen, bot-faithful
context, passes a raw client to registered commands, uses actual Discord.js
`VoiceState` instances and v14-shaped channel managers, and applies real
Mongoose schema casting/validation to its in-memory store. Cron is driven
manually. No bot login, MongoDB, `.env`, or live services are needed.

Tests cover registration, setup/defaults and legacy import, authorization,
limits and permissions, creation/movement rollback, occupancy and restart
cleanup, owner controls and claims, concurrency, and unload/reload. These
offline tests do not replace a deployment smoke test in a Discord test guild.

## License

See [LICENSE](LICENSE). This repository follows ADB's
[contribution guidelines](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CONTRIBUTING.md),
[code of conduct](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CODE_OF_CONDUCT.md),
and [security policy](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/SECURITY.md).
