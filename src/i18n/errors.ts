// Display-time localization for the simulation's English error/feedback
// strings. The sim (src/sim) stays canonical English — the authoritative
// server, the headless env, and the deterministic tests all read these exact
// strings — so instead of changing the sim we translate at the client boundary
// (Hud.showError). Lookups are by exact English text; an unknown string (e.g.
// a rare interpolated message) simply passes through unchanged.

import { getLocale } from './index';

const ERR_ZH: Record<string, string> = {
  // Resource / cast gating
  'Not enough rage!': '怒气不足！',
  'Not enough energy!': '能量不足！',
  'Not enough mana!': '法力不足！',
  'Not enough resource!': '资源不足！',
  'Not enough health.': '生命值不足。',
  'Not enough money.': '金钱不足。',
  'That ability is not ready yet.': '该技能尚未就绪。',
  'That ability requires combo points.': '该技能需要连击点数。',
  'You are busy.': '你正在忙碌中。',
  'You are stunned!': '你被昏迷了！',
  'You have no target.': '你没有目标。',
  'Invalid attack target.': '无效的攻击目标。',
  'Out of range.': '超出范围。',
  'Too close!': '距离太近！',
  'Too far away.': '距离太远了。',
  'Target is too far away.': '目标距离太远。',
  'You must be behind your target.': '你必须位于目标的背后。',
  'You must be facing your target.': '你必须面向你的目标。',
  'You must wield a dagger.': '你必须装备一把匕首。',
  'You have no active Seal.': '你没有激活的封印。',
  'Your target must dodge first.': '你的目标必须先闪躲。',
  'This creature cannot be polymorphed.': '该生物无法被变形。',
  'You cannot equip that.': '你无法装备该物品。',

  // Party / duel / trade
  'A duel is already in progress.': '已经有一场决斗在进行中。',
  'A trade is already in progress.': '已经有一笔交易在进行中。',
  'Only the party leader may invite.': '只有队长才能邀请。',
  'You are not in a party.': '你不在队伍中。',
  'You are not the party leader.': '你不是队长。',
  'That party is full.': '该队伍已满员。',
  'Your party is full.': '你的队伍已满员。',
  'Target is too far away to trade.': '目标距离太远，无法交易。',
  'The challenge has expired.': '挑战已过期。',
  'The invitation has expired.': '邀请已过期。',
  'The trade request has expired.': '交易请求已过期。',
  'Trade failed: items or money no longer available.': '交易失败：物品或金钱已不可用。',

  // Arena
  'You are already in an arena match.': '你已经在一场竞技场对战中。',
  'You cannot queue for the arena while dead.': '你无法在死亡状态下加入竞技场队列。',
  'You cannot queue from inside an instance.': '你无法在副本内加入队列。',
  'You cannot queue while dueling.': '你无法在决斗时加入队列。',
  'Finish your trade before queueing.': '加入队列前请先完成你的交易。',

  // Merchant / World Market
  'It is nailed shut.': '它被钉死了。',
  'Name a price of at least 1 copper.': '定价至少需为 1 铜币。',
  'The Merchant will not broker quest items.': '商人不会代售任务物品。',
  'That is not your listing.': '那不是你的挂售。',
  'That is your own listing — cancel it to reclaim it.': '那是你自己的挂售——取消它即可取回。',
  'That listing is no longer available.': '该挂售已不再可用。',
  'That price is beyond what the Merchant will broker.': '该价格超出了商人愿意代售的范围。',
  'There is no merchant nearby.': '附近没有商人。',
  'You are too far from the Merchant.': '你离商人太远了。',
  'You cannot afford that.': '你买不起那个。',
  'You cannot sell quest items.': '你无法出售任务物品。',
  'You do not have that many to sell.': '你没有那么多可供出售。',
  'You have enough of those.': '你已经有足够多的那种物品了。',
  'You have nothing to collect.': '你没有可领取的东西。',
  'You must bring your goods to the Merchant.': '你必须把货物带到商人处。',

  // Chat
  'You mutter to yourself. Nobody hears it.': '你喃喃自语，没有人听见。',
  'You are sending messages too quickly.': '你发送消息的速度太快了。',
  'You are sending messages too quickly. Slow down.': '你发送消息的速度太快了。慢一点。',
};

export function localizeError(text: string): string {
  if (getLocale() !== 'zh') return text;
  return ERR_ZH[text] ?? text;
}
