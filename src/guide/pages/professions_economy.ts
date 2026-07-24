// Professions economy reference (/wiki/professions/economy): the exact fees,
// sinks, throttles, work orders, and the Maker's Bond commission rules.
// Renders entirely from GUIDE_PROF_ECONOMY plus guide.* t() keys; NPC and
// material names are baked English proper nouns. TRANSPARENCY POLICY
// this page publishes EXACT numbers; the mirrored
// accuracy guards live in tests/guide.test.ts. Distinct from the general
// /wiki/economy page, which stays at systems-and-direction altitude.

import { esc } from '../../ui/esc';
import { formatMoney, formatNumber, t } from '../../ui/i18n';
import { GUIDE_PROF_ECONOMY } from '../content.generated';
import { hrefFor } from '../routes';
import { paras, related } from './ui';

function feesSection(): string {
  const e = GUIDE_PROF_ECONOMY;
  const trainingFees = e.trainingFeeCopperByTier
    .map((fee, tier) =>
      t('guide.profPages.econ.trainingTierFmt', {
        tier: formatNumber(tier),
        fee: fee > 0 ? formatMoney(fee) : t('guide.profPages.econ.free'),
      }),
    )
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
  const rows: [string, string][] = [
    [
      t('guide.profPages.econ.feeCraft'),
      t('guide.profPages.econ.feeCraftValue', {
        fee: formatMoney(e.craftFeeCopperPerBudgetPoint),
      }),
    ],
    [
      t('guide.profPages.econ.feeMarket'),
      t('guide.profPages.econ.feeMarketValue', { pct: formatNumber(e.marketCutPct) }),
    ],
    [t('guide.profPages.econ.feeDeposit'), t('guide.profPages.econ.feeDepositValue')],
    [
      t('guide.profPages.econ.feeUnbind'),
      t('guide.profPages.econ.feeUnbindValue', {
        uncommon: formatMoney(e.unbindFeeCopper.uncommon),
        rare: formatMoney(e.unbindFeeCopper.rare),
        epic: formatMoney(e.unbindFeeCopper.epic),
      }),
    ],
  ];
  const cells = rows
    .map(
      ([label, value]) =>
        `<div class="guide-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
    )
    .join('');
  return `<section class="guide-block" id="prof-fees">
      <h2>${esc(t('guide.profPages.econ.feesHeading'))}</h2>
      ${paras('guide.profPages.econ.feesNote')}
      <dl class="guide-class-facts guide-prof-facts">${cells}</dl>
      <h3>${esc(t('guide.profPages.econ.trainingHeading'))}</h3>
      ${paras('guide.profPages.econ.trainingNote')}
      <ul class="guide-prof-bands">${trainingFees}</ul>
    </section>`;
}

function workOrdersSection(): string {
  const wo = GUIDE_PROF_ECONOMY.workOrders;
  const rows = wo.orders
    .map(
      (o) => `<tr>
        <td>${esc(o.name)}</td>
        <td>${esc(t('guide.profPages.masterFmt', { name: o.master, hub: o.hub }))}</td>
        <td>${esc(t('guide.profPages.matFmt', { name: o.material, count: formatNumber(o.count) }))}</td>
        <td>${esc(formatMoney(o.coinCopper))}</td>
      </tr>`,
    )
    .join('');
  return `<section class="guide-block" id="prof-workorders">
      <h2>${esc(t('guide.profPages.econ.workOrdersHeading'))}</h2>
      ${paras('guide.profPages.econ.workOrdersNote', {
        minutes: formatNumber(wo.cadenceMinutes),
        pct: formatNumber(wo.payoutPctOfVendorValue),
      })}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.econ.colOrder'))}</th>
          <th scope="col">${esc(t('guide.profPages.econ.colMaster'))}</th>
          <th scope="col">${esc(t('guide.profPages.econ.colAsks'))}</th>
          <th scope="col">${esc(t('guide.profPages.econ.colPays'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

export function economyDetailHtml(): string {
  const e = GUIDE_PROF_ECONOMY;
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(t('guide.profPages.econ.title'))}</h1>
      <p class="guide-lead">${esc(t('guide.profPages.econ.intro'))}</p>
      ${feesSection()}
      <section class="guide-block" id="prof-sells">
        <h2>${esc(t('guide.profPages.econ.sellsHeading'))}</h2>
        ${paras('guide.profPages.econ.sellsBody')}
      </section>
      <section class="guide-block" id="prof-market">
        <h2>${esc(t('guide.profPages.econ.marketHeading'))}</h2>
        ${paras('guide.profPages.econ.marketBody')}
      </section>
      ${workOrdersSection()}
      <section class="guide-block" id="prof-commissions">
        <h2>${esc(t('guide.profPages.econ.commissionsHeading'))}</h2>
        ${paras('guide.profPages.econ.commissionsBody')}
      </section>
      <section class="guide-block" id="prof-provenance">
        <h2>${esc(t('guide.profPages.econ.provenanceHeading'))}</h2>
        ${paras('guide.profPages.econ.provenanceBody')}
      </section>
      <section class="guide-block" id="prof-collectors">
        <h2>${esc(t('guide.profPages.econ.collectorsHeading'))}</h2>
        ${paras('guide.profPages.econ.collectorsBody')}
      </section>
      <section class="guide-block" id="prof-throttle">
        <h2>${esc(t('guide.profPages.econ.throttleHeading'))}</h2>
        ${paras('guide.profPages.econ.throttleBody', {
          actions: formatNumber(e.actionThrottle.maxActions),
          seconds: formatNumber(e.actionThrottle.windowSeconds),
        })}
      </section>
      <section class="guide-block" id="prof-doctrine">
        <h2>${esc(t('guide.profPages.econ.doctrineHeading'))}</h2>
        ${paras('guide.profPages.econ.doctrineBody')}
      </section>
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('economy'), key: 'guide.nav.economy' },
        { href: hrefFor('professions/faq'), key: 'guide.profPages.faq.title' },
      ])}
    </article>`;
}
