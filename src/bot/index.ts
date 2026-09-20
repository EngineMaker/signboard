import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { AuthConfig } from '../config.ts';
import type { DB } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import { commands } from './commands.ts';
import { handleDelete, handleList, handlePost, type CommandDeps } from './handlers.ts';

/**
 * Discord Bot。Web サーバーと同一プロセスで動かす（PLAN §1.1）。
 *
 * ロールの判定は interaction に含まれるメンバー情報から行う。
 * Discord がその場で渡してくる値なので、改めて API を叩く必要がない。
 */

/** スラッシュコマンドをギルドに登録する。ギルド単位なら即時反映される。 */
export async function registerCommands(auth: AuthConfig): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(auth.botToken);
  await rest.put(Routes.applicationGuildCommands(auth.clientId, auth.guildId), {
    body: commands,
  });
}

export interface BotHandle {
  client: Client;
  stop: () => Promise<void>;
}

export async function startBot(
  deps: CommandDeps,
  auth: AuthConfig,
): Promise<BotHandle> {
  // Guilds だけで足りる。メッセージ本文を読む必要がないため特権 intent は要らない。
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'signboard') return;

    try {
      await handleInteraction(deps, auth, interaction);
    } catch (err) {
      console.error('[bot] コマンドの処理に失敗:', err);
      const content = 'エラーが発生しました。しばらくしてからもう一度お試しください。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord Bot: ${c.user.tag} として接続`);
  });

  await client.login(auth.botToken);

  return {
    client,
    stop: async () => {
      await client.destroy();
    },
  };
}

/** ロールを検証してからコマンドを実行する。 */
async function handleInteraction(
  deps: CommandDeps,
  auth: AuthConfig,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // DM からは使わせない（ロールを確認できないため）
  if (!interaction.inGuild() || interaction.guildId !== auth.guildId) {
    await interaction.reply({
      content: 'このコマンドはシェアハウスのサーバー内でのみ使えます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasResidentRole(interaction, auth.residentRoleId)) {
    await interaction.reply({
      content: 'このコマンドは EM住民ロールを持っている人だけが使えます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actor = { id: interaction.user.id, name: actorName(interaction) };

  const sub = interaction.options.getSubcommand();
  let reply;

  switch (sub) {
    case 'post':
      reply = handlePost(deps, actor, {
        text: interaction.options.getString('text', true),
        hours: interaction.options.getInteger('hours'),
      });
      break;
    case 'list':
      reply = handleList(deps);
      break;
    case 'delete':
      reply = handleDelete(deps, actor, { id: interaction.options.getInteger('id', true) });
      break;
    default:
      reply = { content: '不明なコマンドです。', ephemeral: true };
  }

  await interaction.reply({
    content: reply.content,
    flags: reply.ephemeral ? MessageFlags.Ephemeral : undefined,
  });
}

/**
 * 監査ログに残す表示名。サーバー内のニックネームがあればそれを優先する
 * （住人同士はニックネームで認識しているため）。
 */
function actorName(interaction: ChatInputCommandInteraction): string {
  const member = interaction.member;
  if (member) {
    // GuildMember（キャッシュあり）と APIInteractionGuildMember で形が違う
    const nick = 'nickname' in member ? member.nickname : member.nick;
    if (nick) return nick;
  }
  return interaction.user.displayName || interaction.user.username;
}

/**
 * interaction に含まれるロール情報を見る。
 * 取得できない形だった場合は false（安全側に倒す。D-012 と同じ方針）。
 */
function hasResidentRole(
  interaction: ChatInputCommandInteraction,
  residentRoleId: string,
): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;

  // ギルドキャッシュがある場合は GuildMemberRoleManager、無ければ ID の配列で来る
  if (Array.isArray(roles)) return roles.includes(residentRoleId);
  if ('cache' in roles) return roles.cache.has(residentRoleId);
  return false;
}
