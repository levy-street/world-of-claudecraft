# Terms and Conditions (marketplace revision)

**DRAFT FOR COUNSEL. PUBLISHED 25 AUGUST 2026 BY OWNER DECISION, AHEAD OF COUNSEL SIGN-OFF.**

The owner elected to publish this revision as the live Terms on 25 August 2026
without waiting for counsel review. The published text is this draft's
marketplace changes applied onto the RICHER live page text (the live
`public/terms.html` carried a newer Section 5 and Section 6 than this draft's
base; see the publication commit). The `[COUNSEL]` questions below remain OPEN:
counsel review of the published text is still owed, and this file remains the
counsel working copy.

This document is a proposed revision of `TERMS_AND_CONDITIONS.md` (the live
Terms, last updated 22 July 2026). It is kept beside the live Terms and does not
replace them. Nothing in this draft binds anyone until counsel has approved it
and it is published as the live Terms. The $WOC marketplace it describes ships
disabled (`WOC_MARKET_ENABLED`, default off, fail-closed) and must not be
enabled on a production realm before that approval; counsel sign-off is tracked
as a launch gate in `docs/woc-marketplace-hardening/state.md` (ruling R6).

Summary of changes against the live Terms:

- Section 6 (acceptable use): the real-money trading prohibition gains a
  carve-out for the marketplace the Game itself operates.
- Section 8 (virtual items): the "no monetary value" and "cannot be redeemed"
  statements are rescoped to trading outside the marketplace, and the
  licence-not-ownership framing is restated to survive a marketplace sale.
- Section 9 (the $WOC token): the "no effect on your account" statement is
  rescoped to token holding (holding grants no gameplay power) and the
  "wallet verification involves no transaction" statement is rescoped to
  wallet linking; marketplace participation is separated out as optional and
  transactional.
- New Section 10 (the $WOC marketplace): the whole marketplace contract:
  real-money item trading, who may participate (an 18+ age floor, browser
  only, and a jurisdiction-refusal right, Section 10.2), terms acceptance,
  custody and escrow, bonds and forfeiture, fees and the burn leg,
  settlement, finality and disputes, prohibited conduct, taxes, and
  availability.
- Section 3 (eligibility) gains a pointer to the marketplace age requirement,
  and the old Section 18 (suspension and termination) gains a sentence on
  resolving marketplace escrow when an account closes.
- Sections 10 to 22 of the live Terms become Sections 11 to 23, with the
  cross-references in the old Sections 13, 18, and 21 updated to match. The
  old Section 18's survival list is additionally expanded so the new Section
  10 survives termination, the old Section 21 (app store terms) additionally
  states that the marketplace is not available in the App on any platform,
  and the old Section 16 (limitation of liability) is unchanged in substance
  but carries a `[COUNSEL]` flag for the liability-cap question.

Open questions for counsel are collected in a decision memo held privately
with the counsel material, outside this repository (the repository is open
source; counsel material does not ship in it). The passages those questions
touch are marked `[COUNSEL]` inline below.

---

# Terms and Conditions

**World of ClaudeCraft**

Last updated: [draft of 13 August 2026; not in force]

## 1. Who we are and what these terms cover

These Terms and Conditions (the "Terms") are a legal agreement between you and Dream Home AI Limited, trading as Levy Street, New Zealand company number 8703066 ("we," "us," "our"). They govern your use of World of ClaudeCraft (the "Game"), worldofclaudecraft.com (the "Site"), and our mobile application (the "App"), together the "Service."

By using the Service you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.

## 2. Changes to these terms

We may update these Terms from time to time. When we make material changes we will update the date above and, where appropriate, give additional notice. Your continued use of the Service after an update means you accept the revised Terms.

## 3. Eligibility

You must be at least 13 years old to use the Service, or older where your country requires a higher minimum age for online services. If you are under the age of majority where you live, you may use the Service only with the involvement and consent of a parent or guardian who agrees to these Terms. The Service is not intended for children under 13.

Participation in the $WOC marketplace (Section 10) has a higher age requirement, set out in Section 10.2.

## 4. The Game and the source code

We grant you a limited, personal, non-exclusive, non-transferable, revocable licence to access and play the Game for your own non-commercial entertainment, subject to these Terms.

The Game's source code is published in a public repository and is licensed to you under the MIT Licence, the full text of which is in the `LICENSE` file in that repository. Nothing in these Terms limits, reduces, or conditions the rights the MIT Licence grants you in that source code. These Terms govern your use of the hosted Service we operate, which is separate from your rights in the code.

The MIT Licence covers source code only. Art, audio, fonts, and other media assets in the repository are not covered by it. Each of those assets is governed by the licence recorded against it in `CREDITS.md`, and that recorded licence controls over the MIT Licence. Some of them may not be redistributed at all, and some may be redistributed only on non-commercial terms. A media asset that is not recorded in `CREDITS.md` is not licensed to you either, because that register is still being completed. Read `CREDITS.md` before you redistribute the repository or use any asset from it, and ask us if something is not listed.

The "World of ClaudeCraft" and "Levy Street" names, logos, and branding are not licensed by the MIT Licence or by these Terms.

## 5. Accounts

To play online you create an account. You agree to provide accurate information, to keep your credentials secure, and to be responsible for all activity under your account. Do not share your account or use anyone else's. Tell us promptly if you suspect unauthorised use. We may refuse, reclaim, or rename accounts or characters that breach these Terms or that use names which are offensive, infringing, impersonating, or misleading.

## 6. Acceptable use and code of conduct

When using the Service you agree not to:

- Cheat, exploit bugs, automate play, use bots, or use unauthorised third-party software to gain an advantage. Development and testing commands are for local development only and must not be used against the live Service.
- Harass, threaten, defame, or abuse other players, or post hateful, obscene, or illegal content in chat, names, or anywhere else.
- Impersonate any person or entity, including us or our staff.
- Disrupt the Service, including through denial-of-service attacks, excessive automated requests, or attempts to overload or interfere with servers.
- Access the Service through unauthorised means, scrape it, or probe, scan, or test its security without permission.
- Reverse engineer, decompile, or attempt to extract source code from the hosted Service, except to the extent applicable law expressly allows and that right cannot be excluded.
- Sell, trade for real money, or commercially exploit accounts, characters, in-game items, or in-game currency, except for sales of eligible in-game items conducted entirely through the $WOC marketplace we operate inside the Game, as Section 10 allows. Selling or trading accounts, characters, or in-game currency for real money remains prohibited everywhere, and selling in-game items for real money anywhere outside that marketplace remains prohibited.
- Use the Service for any unlawful purpose or in breach of these Terms.

We may investigate suspected breaches and may suspend or terminate access, remove content, and report unlawful activity to authorities.

## 7. User content

The Service lets you create content, including character names and chat messages ("User Content"). You keep any rights you have in your User Content. You grant us a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, transmit, display, and moderate your User Content for the purpose of operating, securing, and improving the Service.

You are responsible for your User Content and confirm you have the right to share it and that it does not breach these Terms or any law. We may review, moderate, refuse, or remove User Content, and may withhold or remove names, at our discretion. We are not obliged to monitor User Content, but we may.

## 8. Virtual items and in-game currency

The Game includes virtual items, gear, and in-game currency. You do not own them. We grant you a limited, revocable licence to use them within the Game only, and a sale through the $WOC marketplace (Section 10) transfers that licence between accounts rather than transferring ownership of anything. [COUNSEL]

Outside the $WOC marketplace, virtual items and in-game currency have no monetary value and cannot be redeemed for real money or anything of value outside the Game. We do not sell virtual items or currency, we do not buy them back, and we do not redeem them for money or anything else: the marketplace is player-to-player, and the only real-money value an eligible item ever has is the price another player freely agrees to pay for it there. We make no promise that any item can be sold, will remain eligible for sale, or will hold any price. [COUNSEL]

We may modify, remove, reset, or wipe virtual items, currency, characters, and game worlds at any time, including during testing and balancing, without liability or compensation. This applies to items bought on the marketplace like any others, and to items held in marketplace custody. [COUNSEL] The Game is free to play.

## 9. The $WOC token

A token referred to as $WOC, associated with the community on the Solana network, was created and is controlled by a third party. We do not issue, mint, control, manage, promote as an investment, or guarantee the $WOC token or its value.

- The token is not required to play. Holding it, or not holding it, never grants or withholds gameplay power: holding it has no effect on your characters' stats, progression, drop rates, or any other gameplay outcome. The optional marketplace (Section 10) lets players trade eligible earned items among themselves for $WOC; it does not let anyone buy power from us.
- Linking a wallet to your account is cosmetic and read-only. It is done with one signature, involves no transaction and no transfer of funds, and displays optional flair or a badge.
- Participating in the $WOC marketplace is separate from wallet linking, entirely optional, and does involve real blockchain transactions: payments and bid bonds that you sign in your own wallet. We never hold your keys, and apart from the refundable bid bond described in Section 10.5, which we hold from when your bond payment confirms until it is returned or forfeited, we never hold your funds. [COUNSEL] Section 10 governs that participation.
- Nothing in the Service is financial, investment, legal, or tax advice, or an offer, solicitation, or recommendation to buy, sell, or hold any token or digital asset.
- Digital assets are volatile and carry risk, including total loss, and may be regulated differently in different countries. You are solely responsible for your own decisions and for complying with the laws that apply to you.

To the fullest extent permitted by law, we are not liable for any loss connected with the $WOC token or any third-party token, wallet, exchange, or blockchain.

## 10. The $WOC marketplace

### 10.1 What it is

The Game includes an optional marketplace where players sell eligible in-game items to other players for $WOC ("the Marketplace"). Sales take the form of auctions, fixed-price listings, or direct sales to a named player agreed through the in-game trade window. The Marketplace is player-to-player: we operate the venue, hold listed items in escrow, and charge the fee described in Section 10.7, but we are not the buyer or the seller in any trade, we do not set prices, and we do not sell items or tokens ourselves.

Prices are denominated in US dollars. Payment is made in $WOC: the number of tokens due is calculated only when payment is requested, from a quote based on a current market price of $WOC, and that number can change between quotes. A listing's US dollar price does not change; only the token count at settlement moves with the market. We do not peg or guarantee any exchange rate.

The Marketplace may be unavailable, disabled, or paused at any time (Section 10.10).

### 10.2 Who may participate

To list, bid, or buy you need: an account in good standing, a verified linked Solana wallet, and acceptance of these Marketplace terms (Section 10.3). You must be at least 18 years old, or the age of majority where you live if that is higher, to participate in the Marketplace. [COUNSEL]

The Marketplace is available in the browser version of the Game only. It is not available in the desktop, Steam, iOS, or Android builds. We may restrict or refuse Marketplace access by account, realm, or jurisdiction, including where local law would prohibit or condition it. [COUNSEL]

### 10.3 Accepting these Marketplace terms

Your first Marketplace commitment requires you to accept these Marketplace terms, and we record that acceptance against your account with the time it happened. We only record acceptance through an interface that presents these terms to you, or a clearly labelled link to them, at or before the moment you accept: an acceptance control you act on yourself, such as a checkbox beside the commitment it covers. We do not treat playing the Game, linking a wallet, or any action taken in an interface that did not present these terms as acceptance. [COUNSEL]

### 10.4 Listings, custody, and escrow

When you list an item, or agree a direct sale, the exact item copy leaves your character's bags and is held by the Game in escrow for the life of the listing. While escrowed it cannot be equipped, used, traded, mailed, or listed anywhere else, and you cannot get it back except as these terms describe. If the listing ends without a completed sale (it expires unsold, the reserve is not met, you cancel where cancellation is allowed, the buyer never pays, or the sale otherwise fails), the same copy is returned to you by in-game mail. If the sale completes, the same copy is delivered to the buyer: placed directly into their character's bags, or sent by in-game mail.

We decide which item categories are eligible for the Marketplace, per realm, and may change eligibility at any time. Items already bound to a character, quest items, and any other items or categories we exclude cannot be listed. Delisting a category does not disturb completed sales.

A seller cannot cancel a listing while any bid stands, including a bid whose bond is still being paid, or while a buyer's payment may be in progress; a cancellation requested while a buy-now purchase is pending takes effect only if that purchase does not complete, and player support can cancel a listing only once no payment is in flight. A bid is binding once you sign its bond transaction; before that you may abandon it, and a bid whose bond is never paid lapses on its own after a short period.

### 10.5 Bidding, bid bonds, and forfeiture

Placing an auction bid requires a small refundable bond, denominated in US dollars and paid in $WOC when the bid is placed. The bond is our protection against bidders who win and never pay; it works like this:

- The bond is a percentage of your bid (currently 5%, within a fixed minimum and maximum); the resolved bond amount is shown before you commit. You sign the bond transaction in your own wallet, and your bid becomes active only when that transaction is confirmed.
- Your bond is returned when you are outbid (subject to the second-chance offer below), when the auction ends below its reserve, and when a buy-now purchase closes the auction.
- If you win and complete payment, your bond is returned after settlement confirms.
- If you win and do not pay within the settlement window, you forfeit the bond: it is not returned to you, it never goes to the seller, and it is split between the Game treasury and the permanent token burn. Failing to pay also earns your account a Marketplace strike; repeated strikes earn progressively longer suspensions from the Marketplace.

A bid confirmed in the final minutes of an auction extends the auction by a short period so it can be answered; the total extension is capped at a fixed period past the listed end time.

A seller may enable a second-chance offer when creating a listing. If the winner does not pay, the highest eligible remaining bidder becomes the buyer at their own bid amount, with a fresh settlement window. If that bidder's bond has not yet been returned, it is held again and remains subject to this Section; a bond already returned is not taken again. Not paying within the new window carries the same consequences as any winning bid, except that only a bond we hold can be forfeited. [COUNSEL]

Direct sales agreed through the trade window carry no bond. If you agree a direct purchase and do not pay within its window, the item returns to the seller and your account earns a strike on the same ladder.

On listings other than direct sales, abandoning a buy-now purchase without paying carries no bond and no strike, but it temporarily blocks you from re-claiming that listing, and repeated abandonments within a short period temporarily block new buy-now purchases across your account.

### 10.6 Payment, settlement, and delivery

A winning bidder or buyer pays inside a limited settlement window. Payment works by requesting a quote (the number of $WOC tokens equal to the agreed US dollar price at the current market price; each quote is valid for a short period shown with it), then signing a single Solana transaction in your own wallet that pays the seller, the treasury, and the burn in one step. The Game verifies that transaction's finality on the Solana network before delivering the item.

You pay the network transaction fee. If the market price of $WOC moves between your commitment and your payment, the token count due will differ from the estimate you saw when you committed; the US dollar price does not change. If you do not pay within the settlement window, the sale fails and Section 10.5's consequences apply.

When the price of $WOC cannot be read reliably, or the pricing service is degraded or unreachable, the Marketplace stops accepting new listings, offers, purchases, and bids, and stops issuing payment quotes, until pricing recovers. Auctions keep counting down, settlement windows continue to run during the pause, and a payment already broadcast is still verified and delivered. [COUNSEL]

### 10.7 Fees and the burn

Every completed sale carries a 10% fee, paid by the seller out of the sale amount: 7% of the settlement amount goes to the Game treasury, 3% is permanently burned (destroyed, removing those tokens from circulation), and the seller receives the remainder, paid to the wallet that was verified on their account when the listing was created. Each fee leg is rounded up to the whole cent, so the seller's share can fall up to two cents below 90%. The split is computed inside the settlement transaction and shown to both parties before they confirm, and the treasury and burn addresses are visible on-chain in every settlement transaction. We may change the fee or the split prospectively; a change never applies to a sale already agreed.

### 10.8 Finality, disputes, and refunds

A completed sale is final. Solana transactions cannot be reversed by us or anyone else, and we cannot un-send a payment or claw back a delivered item. Before a sale completes, the protections in Sections 10.4 to 10.6 (escrow, bonds, verified settlement) are the remedy: a failed sale returns the item to the seller and, except for forfeiture under Section 10.5, returns the bond to the bidder.

If something goes wrong, contact player support. We may investigate any listing, sale, or settlement; place a settlement under operator review; suspend or cancel listings (returning the item and refunding bonds where no completed sale stands); exclude sales from public price statistics; and apply or lift strikes and suspensions. These operator remedies act on in-game items, bonds not yet forfeited, and account standing. We do not refund completed on-chain payments, and we are not an arbiter of disputes between players beyond these remedies. [COUNSEL] Nothing in this Section limits rights you have under consumer laws that cannot be excluded (Section 16).

Every completed sale is recorded in a public, per-item sales history that includes the item, price, and the trading characters.

### 10.9 Marketplace conduct

In the Marketplace you agree not to: bid on or buy your own listings, directly or through another account or wallet you control; place bids you do not intend to honour; manipulate prices, including wash trading and shill bidding; use the Marketplace to disguise or settle trades made outside it; interfere with other players' listings or settlements; or evade a strike, suspension, or restriction with another account or wallet. We may remove listings, cancel sales that have not completed, and suspend Marketplace access or the account itself for conduct in this Section, in addition to Section 6.

### 10.10 Availability and changes

The Marketplace is an optional feature of an evolving Game. We may change its rules, fees (prospectively, per Section 10.7), eligibility, and parameters; suspend it; or discontinue it, at any time. If we suspend or discontinue it, escrowed items are returned to their sellers, in-progress settlements are completed or failed under the rules above, and bonds not forfeited are returned. We owe no compensation for lost listings, expected sale proceeds, or the ability to sell.

### 10.11 Taxes and your law

You are solely responsible for any taxes arising from your Marketplace sales and purchases, and for determining whether the Marketplace is lawful for you where you live. We do not withhold or remit taxes for you and we do not provide tax advice. [COUNSEL]

## 11. Donations

Donations through Ko-fi are voluntary. Ko-fi facilitates payments directly through a third-party payment provider such as PayPal or Stripe. Donations are not a purchase, are non-refundable except where the law requires, and do not entitle you to any product, in-game advantage, ownership, equity, token, or other benefit.

## 12. Service availability and changes

The Game is in active development and is provided on an evolving basis. We may change, suspend, limit, or discontinue all or part of the Service, including features, characters, items, and game worlds, at any time and without notice. We do not guarantee uptime, availability, or that the Service will be uninterrupted or error free. We may need to reset or wipe data for technical or balancing reasons.

## 13. Third-party services

The Service links to and relies on third-party services, including GitHub, Ko-fi, PayPal, Stripe, Discord, the Solana network, and any advertising or analytics providers we use. We do not control these services and are not responsible for them. Your use of them is governed by their terms.

## 14. Intellectual property and no affiliation

World of ClaudeCraft is an independent, community project. It is not affiliated with, endorsed by, sponsored by, or associated with any third-party company, game, product, or brand. All third-party names, marks, and trademarks are the property of their respective owners. Any such names that appear are used only descriptively and do not imply any association.

Except for your User Content, the Service, including its original content, features, design, media assets, and branding, is owned by us or our licensors and is protected by intellectual property laws. You may not copy, distribute, or create derivative works from the Service, from the media assets described in Section 4, or from our names, logos, and branding, except as these Terms or the licence recorded in `CREDITS.md` expressly allows, or with our prior written permission. Your rights in the source code are governed by the MIT Licence as described in Section 4, and this Section does not restrict them.

If you believe content on the Service infringes your intellectual property, contact us using Section 23 with enough detail to identify the work and the allegedly infringing material, and we will respond appropriately.

## 15. Disclaimer of warranties

To the fullest extent permitted by law, the Service is provided "as is" and "as available," without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, title, and non-infringement. We do not warrant that the Service will be secure, uninterrupted, error free, or free of harmful components, or that data will not be lost.

## 16. Consumer law

Nothing in these Terms limits rights you have under laws that cannot be excluded, including, for consumers in New Zealand, the Consumer Guarantees Act 1993 and the Fair Trading Act 1986, and similar consumer protection laws elsewhere. Where the Service is supplied free of charge and for personal use, those guarantees apply only to the extent the law requires.

## 17. Limitation of liability

To the fullest extent permitted by law, we and our directors, employees, and contractors will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, progress, profits, goodwill, or virtual items, arising from or related to your use of or inability to use the Service. To the extent we are found liable despite the above, our total liability for all claims relating to the Service is limited to NZD 100. Some jurisdictions do not allow certain limitations, so some of these may not apply to you. [COUNSEL]

## 18. Indemnification

You agree to indemnify and hold us harmless from any claims, losses, liabilities, and expenses, including reasonable legal fees, arising from your breach of these Terms, your User Content, or your misuse of the Service, to the extent permitted by law.

## 19. Suspension and termination

You may stop using the Service and delete your account at any time. We may suspend or terminate your access at any time, with or without notice, if you breach these Terms, if we are required to by law, or to protect the Service or other users. On termination, your licence to use the Service ends. If your account is terminated while you have items in Marketplace escrow or settlements in progress, we resolve them under Section 10 before or alongside closure. Sections that by their nature should survive will survive, including Sections 8 to 18 and 20 to 23.

## 20. Governing law and disputes

These Terms are governed by the laws of New Zealand. The courts of New Zealand have non-exclusive jurisdiction over any dispute, without affecting any mandatory rights you have to bring proceedings in your country of residence.

## 21. General

If any provision of these Terms is held unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent. We may assign them in connection with a merger, acquisition, or sale of assets. These Terms are the entire agreement between you and us regarding the Service.

## 22. App store terms

If you download the App from a third-party app store or platform (each a "Distributor"), the following additional terms apply. In the event of a conflict between these Terms and a Distributor's required terms, the Distributor's required terms apply for that App only and only to the extent of the conflict. The $WOC marketplace (Section 10) is not available in the App on any platform.

### 22.1 Apple App Store

These terms apply if you obtain the App from Apple. You acknowledge and agree that:

1. **Acknowledgement.** These Terms are between you and us only, not with Apple. We, not Apple, are solely responsible for the App and its content.
2. **Scope of licence.** The licence granted to you for the App is a non-transferable licence to use the App on any Apple-branded products that you own or control, as permitted by the Usage Rules in the Apple App Store Terms of Service, except that the App may be accessed by other accounts associated with you via Family Sharing or volume purchasing.
3. **Maintenance and support.** We, not Apple, are solely responsible for any maintenance and support services. Apple has no obligation to provide any maintenance or support for the App.
4. **Warranty.** We are solely responsible for any product warranties, whether express or implied by law, to the extent not effectively disclaimed. If the App fails to conform to any applicable warranty, you may notify Apple, and Apple will refund the purchase price of the App, if any. To the maximum extent permitted by law, Apple has no other warranty obligation with respect to the App.
5. **Product claims.** We, not Apple, are responsible for addressing any claims by you or a third party relating to the App or your use of it, including product liability claims, claims that the App fails to conform to a legal or regulatory requirement, and claims under consumer protection, privacy, or similar laws.
6. **Intellectual property.** In the event of a third-party claim that the App or your use of it infringes that third party's intellectual property rights, we, not Apple, are solely responsible for the investigation, defence, settlement, and discharge of that claim.
7. **Legal compliance.** You represent and warrant that you are not located in a country subject to a U.S. Government embargo or designated as a "terrorist supporting" country, and that you are not listed on any U.S. Government list of prohibited or restricted parties.
8. **Developer name and contact.** Questions, complaints, or claims regarding the App should be directed to us using the contact details in Section 23.
9. **Third-party terms.** You must comply with applicable third-party terms of agreement when using the App.
10. **Third-party beneficiary.** Apple and Apple's subsidiaries are third-party beneficiaries of these Terms, and upon your acceptance of these Terms, Apple will have the right, and will be deemed to have accepted the right, to enforce these Terms against you as a third-party beneficiary.

### 22.2 Google Play

These terms apply if you obtain the App from Google Play. Your use of the App must comply with the then-current Google Play Terms of Service. Google is not a party to these Terms and is not responsible for the App. Any claim relating to the App is between you and us, not Google.

## 23. Contact us

Email: tony@levystreet.com

Postal: Dream Home AI Limited, 262 Thorndon Quay, Wellington 6011, New Zealand
