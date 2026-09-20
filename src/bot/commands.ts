import { SlashCommandBuilder } from 'discord.js';

/**
 * スラッシュコマンドの定義。
 *
 * `/signboard` の下にサブコマンドをぶら下げる。コマンド名が1つで済み、
 * Discord の入力補完でまとまって見えるため。
 */
export const signboardCommand = new SlashCommandBuilder()
  .setName('signboard')
  .setDescription('リビングの電光掲示板を操作します')
  .addSubcommand((sub) =>
    sub
      .setName('post')
      .setDescription('お知らせを掲示板に流します')
      .addStringOption((opt) =>
        opt
          .setName('text')
          .setDescription('流す内容')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('hours')
          .setDescription('何時間表示するか（既定: 24時間）')
          .setMinValue(1)
          .setMaxValue(8760),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('いま掲示板に流れている内容を表示します'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('お知らせを消します')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('消したいお知らせの番号（/signboard list で確認）').setRequired(true),
      ),
  );

export const commands = [signboardCommand.toJSON()];
