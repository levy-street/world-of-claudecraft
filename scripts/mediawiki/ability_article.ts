import { replaceResolvedAbility } from '../../src/sim/combat/action_replacement';
import { druidFormEntryTarget } from '../../src/sim/combat/druid_form_entry';
import { requiredForms } from '../../src/sim/combat/form_requirement';
import { getItemCooldownDuration } from '../../src/sim/content/item_cooldowns';
import { ROW_TREES, specSignatureIds, TALENTS } from '../../src/sim/content/talents';
import { ABILITIES, CLASSES, QUESTS } from '../../src/sim/data';
import type { ResolvedAbility } from '../../src/sim/resolved_ability';
import { type AbilityDef, GCD, MAX_LEVEL, MELEE_RANGE, MIN_GCD } from '../../src/sim/types';
import { abilityDisplayDescription, abilityEffectText } from '../../src/ui/ability_description';
import { abilityIndexGroup, itemActionSource, MEMBERSHIP_GROUP } from './ability_access';
import { referenceAbility, specializationExamples } from './ability_builds';
import { mediawikiAbilityDescription } from './ability_description';
import { abilityScalingLines } from './ability_scaling';
import { type AbilityPageTools, affectedAbilities } from './talent_articles';

function description(res: ResolvedAbility): string {
  if (res.def.id === 'bear_trap') return mediawikiAbilityDescription(res.def);
  return abilityDisplayDescription(res, abilityEffectText(res));
}
function resource(def: AbilityDef): string {
  const entry = def.class === 'druid' ? druidFormEntryTarget(def.id) : null;
  if (entry) return entry === 'bear' ? 'Rage' : 'Energy';
  const forms = requiredForms(def);
  if (forms.length > 1) return 'Rage (Bruin) or Energy (Cat)';
  if (forms.length === 1) return forms[0] === 'bear' ? 'Rage' : 'Energy';
  return CLASSES[def.class].resourceType;
}
function clean(s: string): string {
  return s.replaceAll('_', ' ');
}
function replacementRules(def: AbilityDef) {
  const r = def.actionReplacement;
  return Array.isArray(r) ? r : r ? [r] : [];
}

export function abilityArticle(
  def: AbilityDef,
  { link, section, table, bullets, titleBy }: AbilityPageTools,
): string {
  const item = itemActionSource(def);
  if (item) {
    const title = titleBy.item?.get(item.id);
    const bomb = title ? link(title, item.name) : item.name;
    return (
      section(
        'How it works',
        'Use ' +
          bomb +
          ' from your bags or action bar. It explodes at the spot you aim at. Every living mob within 5 yd of the blast takes 120 to 160 Nature damage. All of them take the same roll. The roll is based on the game clock. Spell Power and Attack Power do not add to it.',
      ) +
      section(
        'Item use',
        table([
          ['Source', bomb],
          ['Who can use it', 'Any class carrying the item'],
          ['Cost', 'Uses up one bomb each time it works'],
          ['Cooldown', getItemCooldownDuration(item.id) + ' sec'],
          [
            'Range',
            'Up to 30 yd. If you aim farther, it lands at 30 yd. If you do not aim at the ground, it lands 8 yd straight ahead.',
          ],
        ]),
      )
    );
  }
  const className = abilityIndexGroup(def);
  const specName = (id: string) =>
    TALENTS[def.class].specs.find((s) => s.id === id)?.name ?? clean(id);
  const specLink = (id: string) => {
    const title = titleBy.spec?.get(def.class + '/' + id);
    return title ? link(title, specName(id)) : specName(id);
  };
  const abilityLink = (id: string) =>
    titleBy.ability.has(id)
      ? link(titleBy.ability.get(id)!, ABILITIES[id].name)
      : (ABILITIES[id]?.name ?? clean(id));
  const classGrant =
    className === MEMBERSHIP_GROUP
      ? 'All classes with active membership'
      : link(titleBy.class.get(def.class)!, className);
  const base = referenceAbility(def);
  const grantChoices = ROW_TREES[def.class].flatMap((row) =>
    row.options
      .filter((o) => o.effect.grant?.ability === def.id)
      .map((o) => ({ level: row.level, option: o })),
  );
  const signatures = TALENTS[def.class].specs.filter((s) => specSignatureIds(s).includes(def.id));
  const sourceActions = Object.values(ABILITIES).filter(
    (other) =>
      !other.hiddenFromPlayer && replacementRules(other).some((rule) => rule.abilityId === def.id),
  );
  const rankLevel =
    grantChoices.length && !CLASSES[def.class].abilities.includes(def.id)
      ? Math.min(...grantChoices.map((r) => r.level))
      : def.learnLevel;
  const grantRows: string[][] = [['Class', classGrant]];
  if (!sourceActions.length || CLASSES[def.class].abilities.includes(def.id))
    grantRows.push([
      'First rank',
      'Level ' +
        (signatures.length && !CLASSES[def.class].abilities.includes(def.id)
          ? '5 (specialization grant)'
          : rankLevel),
    ]);
  if (signatures.length)
    grantRows.push(['Signature of', signatures.map((s) => specLink(s.id)).join(', ')]);
  if (grantChoices.length)
    grantRows.push([
      'Talent grant',
      grantChoices
        .map(({ level, option }) => {
          const t = titleBy.talent?.get(def.class + '/' + option.id);
          return (t ? link(t, option.name) : option.name) + ' (level ' + level + ')';
        })
        .join(', '),
    ]);
  if (sourceActions.length)
    grantRows.push(['Changes from', sourceActions.map((a) => abilityLink(a.id)).join(', ')]);
  if (def.specs?.length)
    grantRows.push(['Available specializations', def.specs.map(specLink).join(', ')]);
  if (def.excludeSpecs?.length)
    grantRows.push([
      'Unavailable after choosing',
      def.excludeSpecs.map(specLink).join(', ') +
        (def.excludeSpecsAtLevel ? ' from level ' + def.excludeSpecsAtLevel : ''),
    ]);
  if (def.requiresQuest && titleBy.quest.has(def.requiresQuest))
    grantRows.push([
      'Required quest',
      link(titleBy.quest.get(def.requiresQuest)!, QUESTS[def.requiresQuest].name),
    ]);
  const details: string[][] = [
    ['School', clean(def.school)],
    [
      'Activation',
      def.passive
        ? 'Passive'
        : def.onNextSwing
          ? 'Happens on your next weapon swing'
          : def.channel
            ? `Channel for ${def.channel.duration} sec, ${def.channel.ticks} pulses`
            : def.castTime > 0
              ? `${def.castTime} sec cast`
              : 'Instant',
    ],
  ];
  if (!def.passive) {
    details.push([
      'Base cost',
      def.spendsAllResource
        ? `Uses all your ${resource(def)}${def.spendResourceCap ? ', up to ' + def.spendResourceCap : ''}. You need at least ${def.cost}.`
        : def.cost
          ? def.cost + ' ' + resource(def)
          : 'Free',
    ]);
    details.push([
      def.maxCharges ? 'Recharge per charge' : 'Base cooldown',
      def.cooldown ? def.cooldown + ' sec' : 'None',
    ]);
    if (def.maxCharges) details.push(['Maximum charges', String(def.maxCharges)]);
    details.push([
      'Global cooldown',
      def.offGcd
        ? 'Off the global cooldown'
        : `${def.class === 'rogue' ? 1 : GCD} sec. Haste can make it shorter, but never below ${MIN_GCD} sec.`,
    ]);
    const target = def.targetsDead
      ? 'Dead ally'
      : def.selfCentered
        ? 'The area around you'
        : def.targetMode === 'position'
          ? 'A spot on the ground that you aim at'
          : def.targetType === 'friendly'
            ? 'An ally or yourself'
            : def.targetType === 'any'
              ? 'An ally or an enemy'
              : def.requiresTarget
                ? 'An enemy'
                : 'You do not need a target';
    details.push(['Target', target + (def.partyOnlyTarget ? ' (your group or raid only)' : '')]);
    if (def.range > 0 || def.requiresTarget)
      details.push([
        'Range',
        (def.minRange ? def.minRange + ' to ' : '') + (def.range || MELEE_RANGE) + ' yd',
      ]);
  }
  const requirements: string[] = [];
  if (requiredForms(def).length)
    requirements.push(
      'You must be in ' +
        requiredForms(def)
          .map((f) => (f === 'bear' ? 'Bruin Form' : 'Cat Form'))
          .join(' or ') +
        '.',
    );
  if (def.requiresShield) requirements.push('You must have a shield equipped.');
  if (def.requiresStealth) requirements.push('You must be in stealth.');
  if (def.requiresOutOfCombat) requirements.push('You can only use it out of combat.');
  if (def.requiresOutsideInstance) requirements.push('You cannot use it in dungeons or raids.');
  if (def.requiresDodgeProc)
    requirements.push('You can only use it for 5 sec after an enemy dodges your attack.');
  if (def.executeThreshold !== undefined)
    requirements.push(
      `Only works on a target with less than ${def.executeThreshold * 100}% health.`,
    );
  if (def.requiresTargetHpBelow !== undefined)
    requirements.push(
      `Only works on a target with ${def.requiresTargetHpBelow * 100}% health or less.`,
    );
  if (def.requiresAuraKind)
    requirements.push(
      `You need ${def.requiresAuraStacks ?? 1} stack(s) of ${clean(def.requiresAuraKind)} on you${def.requiresOwnAura ? ', put there by you' : ''}.`,
    );
  if (def.spendsCombo)
    requirements.push(
      `Uses up your combo points on the target.${def.comboOptional ? ' You can still use it with zero points.' : ''}`,
    );
  if (def.awardsCombo) requirements.push(`Gives ${def.awardsCombo} combo point(s) when it hits.`);
  if (def.ruinCost) requirements.push(`Also costs ${def.ruinCost} Ruin.`);
  if (def.devotionCost) requirements.push(`Also costs ${def.devotionCost} Devotion.`);
  if (def.soulFragmentCost) requirements.push(`Also costs ${def.soulFragmentCost} Soul Fragments.`);
  if (def.castWhileMoving) requirements.push('You can cast while moving.');
  if (def.usableWhileCasting) requirements.push('You can use it while casting something else.');
  if (def.uninterruptible) requirements.push('Interrupts cannot stop this cast.');
  if (def.usableWhileControlled) requirements.push('You can use it even while crowd controlled.');
  if (def.empowerStages)
    requirements.push(
      `Hold the button to charge it up, through up to ${def.empowerStages} stages.`,
    );
  for (const r of replacementRules(def)) {
    const gates = [
      r.auraKind ? `${r.minStacks ?? 1} stack(s) of ${clean(r.auraKind)}` : '',
      r.actorAuraKind ? clean(r.actorAuraKind) : '',
      r.absentAuraKind ? 'no ' + clean(r.absentAuraKind) : '',
    ].filter(Boolean);
    requirements.push(
      'This button turns into ' +
        abilityLink(r.abilityId) +
        ' while you have ' +
        gates.join(' and ') +
        '.',
    );
  }
  const rankSections = [
    base,
    ...(def.ranks ?? []).map((rank) => replaceResolvedAbility(base, def.id, rank.level)),
  ];
  const scaling = abilityScalingLines(base);
  let text =
    section('How it works', description(base)) +
    section('Learn and use', table([...grantRows, ...details]));
  if (requirements.length) text += section('Cast rules', bullets(requirements));
  if (scaling.length)
    text += section(
      'Base scaling',
      "These are rank 1 numbers. They do not include your specialization, talents, buffs or critical hits. They also do not include the target's defenses.\n" +
        bullets(scaling),
    );
  if (rankSections.length > 1)
    text += section(
      'Higher ranks',
      table(
        rankSections.slice(1).map((res, i) => {
          const rank = def.ranks![i];
          return [
            `Rank ${rank.rank} (level ${rank.level})`,
            [
              `${res.cost} ${resource(def)}, ${def.channel ? def.channel.duration + ' sec channel' : res.castTime ? res.castTime + ' sec cast' : 'instant'}.`,
              description(res),
              ...abilityScalingLines(res),
              ...(res.threatFlat ? [`Adds ${res.threatFlat} threat.`] : []),
            ].join(' '),
          ];
        }),
      ),
    );
  if (base.threatFlat || base.threatMult !== 1)
    text += section(
      'Threat',
      `Rank 1 adds ${base.threatFlat} threat. The threat from its damage is also multiplied by ${base.threatMult}. Stance and form bonuses to threat are applied after that.`,
    );
  const buildRules = Object.entries(def.specNotes ?? {}).map(
    ([id, note]) => specLink(id) + ': ' + note,
  );
  for (const row of ROW_TREES[def.class])
    for (const option of row.options) {
      if (
        !affectedAbilities(option.effect).includes(def.id) ||
        option.effect.grant?.ability === def.id
      )
        continue;
      const title = titleBy.talent?.get(def.class + '/' + option.id);
      buildRules.push(
        (title ? link(title, option.name) : option.name) +
          ' (level ' +
          row.level +
          '): ' +
          option.description,
      );
    }
  if (buildRules.length)
    text += section('Specialization and talent interactions', bullets(buildRules));
  const examples = specializationExamples(rankSections[rankSections.length - 1]);
  if (examples.length)
    text += section(
      'What changes with specialization',
      'Level ' +
        MAX_LEVEL +
        ' spellbook numbers. They assume no talent choices, no gear bonuses and no buffs. Each row first shows the numbers with 0 power.' +
        '\n' +
        table(examples.map(([spec, value]) => [specLink(spec), value])),
    );
  return text;
}
