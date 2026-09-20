import { fetchMemberRoles } from './discord.ts';

/**
 * EM住民ロールを持っているか判定する。
 *
 * 安全側に倒す方針:
 *  - サーバーに居ない → false
 *  - ロールを持っていない → false
 *  - Discord API がエラー → **false**（通信できないときに通してしまわない）
 */
export async function hasResidentRole(
  userId: string,
  opts: { botToken: string; guildId: string; residentRoleId: string },
): Promise<boolean> {
  let roles: string[] | null;
  try {
    roles = await fetchMemberRoles(userId, opts);
  } catch {
    return false;
  }

  if (roles === null) return false;
  return roles.includes(opts.residentRoleId);
}
