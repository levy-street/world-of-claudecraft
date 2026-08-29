# 20 mutation log: every marketplace real-SQL pin, red-on-strip

One row per distinct mutant (the LAST run is the verdict; earlier rounds that
a later pin superseded are listed in the history column). Harness protocol per
mutant: lane worktree clean, literal replace asserted to its occurrence count,
git diff proves the patch applied, vitest run on the owning suites with
TEST_DATABASE_URL, the Tests summary line proves assertions RAN, revert by
git checkout over the committed tree, byte-identical verification after.

Replacement policy (so a red is never a parameter-arity artifact): a stripped
qual that binds a parameter is replaced by a TYPED always-true over the same
parameter (`realm = $n` becomes `$n::text = $n::text`), never deleted; a
stripped TypeScript guard becomes `if (false)`; a dropped SET value keeps its
bind via NULLIF($n, $n); DDL mutants drop or loosen the named constraint.
SURVIVED entries are the judged defense-in-depth singles, each paired with a
listed double-strip mutant that BIT, or the deliberate no-op control.

Lane isolation rule (the collision class this round hit once, in a gate run):
every pg rig hard-codes its verify database name, so the SAME suite must
never run in two processes at once; a collision reds the victim without
running assertions, which a careless reader could score as a BIT. Run pg
suites one lane at a time per suite (the three scratch lanes partitioned by
suite, or strictly serialized), and treat a mid-run "database ... does not
exist" as the collision signature, never as a verdict.

| mutant | verdict | suites | history |
|---|---|---|---|
| SMOKE_claimCustodyRef_onconflict | BIT | woc_market_delivery_pg_integration | smoke |
| SMOKE_comment_only_control | SURVIVED | woc_market_delivery_pg_integration | smoke |
| abandonBid_account | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core > round4 |
| abandonBid_signed_immovable | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core |
| abandonBid_status | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core > round4 |
| abandon_exempt_buyer | BIT | woc_market_bond_pg_integration | batch3 > round4 > round5 |
| abandon_exempt_reason_set | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| abandon_exempt_signature | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| abandon_exempt_window | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| abandon_on_conflict | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| acceptedUnstamped_maxage_guard | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core |
| acceptedUnstamped_young_guard | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core |
| activate_listing_board_skip | BIT | woc_market_bond_pg_integration | round6 |
| activate_listing_closed_or_ended | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| activate_not_pending | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| activate_outbid_prior_active_only | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| activate_prelock_desc_flip | BIT | woc_market_directed_sql | round6 |
| activate_prelock_open_set | BIT | woc_market_directed_sql | batch3 > round4 > round5 |
| activate_supersede_refund_due | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| activate_superseded | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| activate_superseded_boundary | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| bid_cancel_pending | BIT | woc_market_bond_pg_integration | round2 |
| bid_directed_not_found | BIT | woc_market_bond_pg_integration | round2 |
| bid_ends_at_boundary | BIT | woc_market_bond_pg_integration | round2 |
| bid_ends_at_lapsed | BIT | woc_market_bond_pg_integration | round2 |
| bid_own_account | BIT | woc_market_bond_pg_integration | round2 |
| bid_pending_account_qual | BIT | woc_market_bond_pg_integration | round2 |
| bid_pending_listing_qual | BIT | woc_market_bond_pg_integration | round2 |
| bid_pending_status_qual | BIT | woc_market_bond_pg_integration | round2 |
| bid_status_active | BIT | woc_market_bond_pg_integration | round2 |
| bid_too_low | BIT | woc_market_bond_pg_integration | round2 |
| bid_too_low_boundary | BIT | woc_market_bond_pg_integration | round2 |
| bid_wallet_twin | BIT | woc_market_bond_pg_integration | round2 |
| bondSig_anchor_first_recording | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| bondSig_different_refuses | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| bondSig_reused_typed | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| bondSig_status_pending | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| bond_signature_value_dropped | BIT | woc_market_bond_pg_integration | round6 |
| bondsDue_states | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| browse_status_liveness | BIT | woc_market_realm_scope_pg_integration | round5 |
| cancelPending_lock_expired | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core > round4 |
| cancel_failed_expiry_state_guard | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cancel_has_bids | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cancel_intent_coalesce_first_stamp | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cancel_not_active | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cancel_not_yours | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cancel_open_settlement_live | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| cancel_paid_window_settlement_live | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| cap_account_qual | BIT | woc_market_bond_pg_integration | round5 |
| claimDeliverable_confirmed_only | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core |
| claimDue_ends_at | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core > round4 |
| claimDue_status_active | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core > round4 |
| claim_advisory_directed_gate | BIT | woc_market_bond_pg_integration | round5 |
| claim_cooldown_advisory_gate | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_cooldown_shortcut_lock_null | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_cooldown_tx_directed_exempt | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| claim_cooldown_tx_gate | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_diag_cancel_pending | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_diag_lock_held | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_diag_no_buy_now | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| claim_diag_not_active | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| claim_diag_own_account | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| claim_open_settlement_advisory | BIT | woc_market_directed_sql | batch3 > round4 > round6 |
| claim_open_settlement_double | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | round4 |
| claim_open_settlement_tx | SURVIVED | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| claim_record_abandon_directed_exempt | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_record_abandon_gate | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| claim_wallet_twin_double_strip | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 |
| claim_wallet_twin_locked_check | SURVIVED | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| claim_wallet_twin_not_exists | SURVIVED | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| claim_zero_rows_double | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | round4 |
| claim_zero_rows_own_listing | SURVIVED | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| clearBuyNowLock_holder_guard | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| clearStrikes_account | BIT | woc_market_directed_pg_integration | round5 |
| closeCancel_bids_skip | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| closeCancel_failed_expiry_state_guard | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| closeCancel_lock_unexpired_skip | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| closeCancel_open_skip | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| closeIfNoOpen_closed_check | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| closeIfNoOpen_open_check | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| closeListing_not_closed | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| confirmingBonds_signed_only | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core > round4 |
| confirmingOverdue_age | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core |
| cooldown_cap_offset | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| cooldown_cap_window | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| cooldown_latest_listing_scope | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| cooldown_latest_window | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| custody_booked_flip_onceway | BIT | woc_market_delivery_pg_integration | core > round4 |
| custody_grant_intent_unbooked_only | BIT | woc_market_delivery_pg_integration | core > round4 |
| custody_mail_intent_unbooked_only | BIT | woc_market_delivery_pg_integration | core > round4 |
| custody_mail_intent_withdraws_grant | BIT | woc_market_delivery_pg_integration | core > round4 |
| ddl_abandons_once_columns | BIT | woc_market_bond_pg_integration | batch3 > round4 |
| ddl_bid_bond_state_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_bond_reference_unique | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| ddl_custody_ref_pk | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| ddl_listing_format_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_listing_item_object_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_listing_status_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_offer_itemref_check_drop | BIT | woc_market_settlement_pg_integration | round6 |
| ddl_offer_status_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_open2_predicate | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| ddl_pair_index_predicate | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 |
| ddl_sales_item_check_drop | BIT | woc_market_settlement_pg_integration | round6 |
| ddl_sales_once_columns | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| ddl_settlement_state_check | BIT | woc_market_settlement_pg_integration | round5 |
| ddl_tx_signature_unique | BIT | woc_market_settlement_pg_integration | batch3 > round4 |
| deliveredPage_delivered_only | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core |
| deliveryTarget_fallback_account | BIT | woc_market_realm_scope_pg_integration | core > round4 |
| deliveryTarget_preferred_account | BIT | woc_market_realm_scope_pg_integration | core > round4 |
| dispose_resolution_sold | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core > round4 |
| dispose_sale_exists | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core |
| dispose_sale_not_excluded | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core > round4 |
| escrow_cap_boundary | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core |
| escrow_cap_not_closed | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| escrow_lease_fence | BIT | woc_market_delivery_pg_integration | core |
| escrow_stamp_listing_null | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| escrow_stamp_status_accepted | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| escrow_stamp_zero_rows_abort | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| expireDue_outer_status | BIT | woc_market_directed_sql | core > round4 > round5 |
| expireIfUnstamped_listing_null | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| fake_cap_clamp_strip | BIT | fake_woc_market_db | round5 |
| fake_offer_clone_strip | BIT | fake_woc_market_db | round5 |
| fake_sig_order_revert | BIT | fake_woc_market_db | round5 |
| fake_twin_guard_strip | BIT | fake_woc_market_db | round5 |
| finalize_close_cas | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| finalize_delivered_cas | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 > round4 |
| finalize_prelock_winner | BIT | woc_market_directed_sql | batch3 > round4 > round5 |
| finalize_resolution_keep | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 > round4 |
| finalize_sale_once_conflict | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| finalize_stale_zero | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 > round4 |
| finalize_teardown_carveout | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| finalize_winner_bond_held_only | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 > round4 |
| insertSettlement_23505_typed | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| insertSettlement_closed_double_strip | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| insertSettlement_lock_status_closed | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| insertSettlement_select_not_closed | SURVIVED | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| insertSettlement_winner_cas | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| insertSettlement_winner_gone | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| lapseBid_held_immovable | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| lapseBid_status | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| lapsePending_signed_immovable | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | core |
| lapse_placed_at_gate | BIT | woc_market_realm_scope_pg_integration | round5 |
| markBidStatus_from_set | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| markBondHeld_from_pending | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| markSettling_from_set | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| nextCascade_min_boundary | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| nextCascade_outbid_only | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| nextCascade_prior_winner_excluded | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| outbidQueue_active_only | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| outbidQueue_held_refund | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| overdue_deadline | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core |
| overdue_state_set | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core > round4 |
| quote_expired_boundary | BIT | woc_market_service | round6 > round6 |
| realm_1343_escrowInsertListing.capCount | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1401_escrowInsertListing.stamp | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1423_listingById | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1440_browseListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1505_opsListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1554_opsP2pTrades | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1600_listingsBySeller | BIT | woc_market_realm_scope_pg_integration | realm > round6 |
| realm_1624_countActiveBySeller | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1685_directedOfferById | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1724_consumeStepUpChallenge | BIT | woc_market_stepup_pg_integration | realm |
| realm_1744_pruneStepUpChallenges | BIT | woc_market_stepup_pg_integration | realm |
| realm_1779_directedOffersForAccount | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1828_resolveDirectedOffer | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1843_characterByName | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1873_acceptDirectedOfferSide | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1905_reopenDirectedOffer.outer | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1908_reopenDirectedOffer.notExists | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1939_expireDueDirectedOffers | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1968_acceptedUnstampedOffers | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_1985_expireDirectedOfferIfUnstamped | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2009_directedOffersForBuyer | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2052_cancelListingIfUnbid | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2184_suspendListingIfSafe | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2279_claimDueListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2380_undisposedClosedListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2397_strandedListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2595_stuck.claims | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2605_stuck.delivering | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2615_stuck.undisposed | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2629_stuck.review | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2646_stuck.bonds | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2832_claimBuyNowLock.capProbe | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_2869_2914_combined | BIT | woc_market_realm_scope_pg_integration | round2 |
| realm_2869_claimBuyNowLock.peek | BIT | woc_market_realm_scope_pg_integration | realm > round2 |
| realm_2914_claimBuyNowLock.locked | SURVIVED | woc_market_realm_scope_pg_integration | realm > round2 |
| realm_3065_cancelPendingListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3103_closeCancelPendingListing | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3202_insertPendingBid | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3304_extendAuctionForBondProgress | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3383_confirmingBonds | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3473_abandonPendingBid | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3602_lapsePendingBids | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3632_bidsByAccount | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3707_bondsDue | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3846_settlementsByAccount | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3933_confirmingSettlements | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3946_claimDeliverableSettlements | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3964_deliveringSettlements | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_3998_deliveredUnclosedSettlementsPage | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_4045_disposeSoldResidueListings | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_4248_overdueSettlements | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_4269_confirmingOverdueSettlements | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_4307_salesForItem | BIT | woc_market_realm_scope_pg_integration | realm > round2 |
| realm_4393_deliveryTarget.preferred | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_4401_deliveryTarget.fallback | BIT | woc_market_realm_scope_pg_integration | realm |
| realm_754_ddl.pairRepair.realmJoin | BIT | woc_market_directed_pg_integration, woc_market_realm_scope_pg_integration | realm > round2 |
| realm_770_ddl.pairIndex.realmColumn | BIT | woc_market_realm_scope_pg_integration, woc_market_directed_pg_integration | realm |
| reopenListing_failed_arm | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| reopenListing_from_states | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| reopenListing_not_exists | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| reopen_listing_id_null | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| reopen_not_exists_pair | SURVIVED | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| reopen_notexists_plus_catch | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | round4 |
| reopen_status_accepted | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | core > round4 |
| salesForItem_excluded | BIT | woc_market_realm_scope_pg_integration | round5 |
| saveDelivered_booked_null | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| saveDelivered_claim_missing | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| saveDelivered_lease_fence | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | batch3 |
| setBidBondQuote_signed_immovable | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| setBidBondQuote_status | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 > round4 |
| setBondState_from_set | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| setSaleExcluded_conflict_typed | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| settle_quote_offered_only | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core |
| settle_signature_offered_only | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core > round4 |
| settle_signature_reused_typed | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core > batch3 > round4 |
| settle_signature_value_dropped | BIT | woc_market_settlement_pg_integration | round6 |
| settle_transition_23505_false | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core |
| settle_transition_cas | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | core |
| stepup_consume_account | BIT | woc_market_stepup_pg_integration | core |
| stepup_prune_expiry | BIT | woc_market_stepup_pg_integration | core |
| stranded_age_bound | BIT | woc_market_realm_scope_pg_integration | round5 |
| strikes_greatest | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| strikes_increment | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| stuck_review_state | BIT | woc_market_realm_scope_pg_integration | round5 |
| suspend_buy_now_pending | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| suspend_closed_not_active | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| suspend_expired_won_teardown_only | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| suspend_held_refund_due | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| suspend_open_settlement_live | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 > round4 |
| suspend_prelock_won | BIT | woc_market_directed_sql | batch3 > round4 > round5 |
| suspend_quoted_offered_refuses | BIT | woc_market_settlement_pg_integration, woc_market_delivery_pg_integration | batch3 |
| suspend_teardown_carveout | BIT | woc_market_bond_pg_integration, woc_market_directed_pg_integration | batch3 |
| terms_first_acceptance_durable | BIT | woc_market_directed_pg_integration, woc_market_bond_pg_integration | batch3 > round4 |
| undisposed_item_disposed_false | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core > round4 |
| undisposed_not_sold | BIT | woc_market_delivery_pg_integration, woc_market_settlement_pg_integration | core > round4 |

Totals: 248 distinct mutants, 240 BIT, 8 SURVIVED (1 no-op control + 7 judged twins, each double-strip proven).

## 20 QA round appendix (independent mutants, run by the QA session)

Same harness protocol and replacement policy as above; run in the scratch
lanes wocc-marketplace-mut1/2/3 over the committed QA-round tips (7b8083abe9,
then c270f43dda and d9293f61f3 for the rows their fixes enabled), partitioned
so no two lanes ran the same suite concurrently. The QA session first
independently re-verified five existing rows with its own strips (bid_own_account,
SMOKE_claimCustodyRef_onconflict via an ON CONFLICT DO UPDATE shape,
settle_transition_cas, realm_1600_listingsBySeller, quote_expired_boundary;
all five BIT), then ran the rows below for the predicates the audit lanes
found unlogged or unpinned. Two rows needed an in-round fix before their
mutant bit, and the green control needed the same fix wave before reaching
its expected green; each says so in the history column. qa20_cap_bump_control is a
deliberate GREEN control: it raises WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR to 4
and expects the bond suite to stay green, proving the at-cap fixtures derive
from the constant (its FIRST run failed three fixtures that hard-coded the
cap; they now derive, and the re-run is green).

| mutant | verdict | suites | history |
|---|---|---|---|
| qa20_offersForAccount_participant | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_bidsByAccount_account | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_settlementsByAccount_buyer | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_offersForBuyer_addressee | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_offersForBuyer_not_closed | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_expireDue_inner_due_bound | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_expireDue_inner_status | SURVIVED | woc_market_realm_scope_pg_integration | qa20; masked by the floor-pinned outer status qual, judged single |
| qa20_expireDue_status_double_strip | BIT | woc_market_realm_scope_pg_integration | qa20; the double-strip proof for the row above |
| qa20_undisposed_status_closed | BIT | woc_market_realm_scope_pg_integration | qa20 |
| qa20_lapse_inner_status | BIT | woc_market_realm_scope_pg_integration, woc_market_bond_pg_integration | qa20; survived until d9293f61f3 seeded the aged resolved bid |
| qa20_confirmingBonds_status | BIT | woc_market_bond_pg_integration | qa20 |
| qa20_extend_status_guard | BIT | woc_market_bond_pg_integration | qa20 |
| qa20_twin_steal_record_order | BIT | woc_market_bond_pg_integration | qa20 |
| qa20_anti_enum_directed_rerun | BIT | woc_market_bond_pg_integration | qa20; the directed-arm strip now also reds the verdict-order arm |
| qa20_cap_bump_control | GREEN CONTROL | woc_market_bond_pg_integration | qa20; red on three hard-coded fixtures first, green after c270f43dda derives them |
| qa20_cap_bump_plus_account_strip | BIT | woc_market_bond_pg_integration | qa20; the raised-cap account-qual strip still reds |
| qa20_ddl_stepup_nonce_pk | BIT | woc_market_stepup_pg_integration | qa20 |
| qa20_ddl_stepup_operation_check | BIT | woc_market_stepup_pg_integration | qa20 |
| qa20_ddl_stepup_fk_cascade | BIT | woc_market_stepup_pg_integration | qa20 |
| qa20_ddl_bond_signature_unique_drop | BIT | woc_market_bond_pg_integration | qa20 |
| qa20_dispose_already_disposed | BIT | woc_market_delivery_pg_integration | qa20 |
| qa20_ddl_listing_resolution_check | BIT | woc_market_settlement_pg_integration | qa20 |
| qa20_ddl_bid_status_check | BIT | woc_market_settlement_pg_integration | qa20 |
| qa20_liveSettlement_states | BIT | woc_market_settlement_pg_integration | qa20 |
| qa20_insertOffer_23505_belt | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_resolveOffer_status_cas | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_acceptOffer_status_cas | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_everSettled_listing_qual | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_reopen_seller_reset_dropped | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_reopen_itemref_reset_dropped | BIT | woc_market_directed_pg_integration | qa20 |
| qa20_svcquote_not_yours | BIT | woc_market_service | qa20 |
| qa20_quote_revival_order | BIT | woc_market_service | qa20 |
| qa20_suspend_prelock_desc | BIT | woc_market_directed_sql | qa20 |
| qa20_readout_clamp_strip | BIT | woc_market_directed_sql | qa20 |
| qa20_sweep_lock_realm | BIT | woc_market_sweep | qa20 |
| qa20_prune_closed_pair_strip | BIT | woc_market_directed_sql | qa20 |
| qa20_prune_booked_flag_strip | BIT | woc_market_directed_sql | qa20 |
| qa20_prune_abandons_age_strip | BIT | woc_market_directed_sql | qa20; survived until c270f43dda pinned the cutoff text |
| qa20_prune_resolved_status_strip | BIT | woc_market_directed_sql | qa20 |
| qa20_fake_stuckbonds_order_revert | BIT | fake_woc_market_db | qa20 |
| qa20_fake_accept_clone_strip | BIT | fake_woc_market_db | qa20 |
| qa20_fake_account_clone_strip | BIT | fake_woc_market_db | qa20 |
| qa20_fake_twin_record_order | BIT | fake_woc_market_db | qa20 |
| qa20_fake_escrow_hook_order | BIT | fake_woc_market_db | qa20 |
| qa20_rules_list_second_member | BIT | woc_market_rules | qa20 |

Appendix totals: 45 distinct mutants, 43 BIT, 1 judged defense-in-depth
single (double-strip proven), 1 deliberate green control; plus 5 independent
re-verifications of existing rows, all BIT. Whole log after this round: 293
distinct mutants.

## Escrow write-path rider section (run by the rider implement session)

Same protocol as the header: every strip occurrence-asserted (region-scoped
where a literal repeats), git-diff-proven, run-proven by the Tests summary
line, reverted by git checkout over the committed tree with a clean-status
verify after. One serial lane in the rider worktree (no concurrent pg runs;
the two pg mutants ran alone with TEST_DATABASE_URL). Replacement policy per
the header; suites named per row are the OWNING suites the verdict was
scored against.

| mutant | verdict | suites | history |
|---|---|---|---|
| rider_gate_cap_check | BIT | woc_market_escrow_gate | rider |
| rider_gate_release_shift | BIT | woc_market_escrow_gate, woc_market_escrow_queue | rider |
| rider_gate_reclaim_strip | BIT | woc_market_escrow_gate | rider |
| rider_custody_realm_gate_strip | BIT | woc_market_escrow_queue | rider |
| rider_custody_settled_emit_strip | BIT | woc_market_escrow_queue | rider |
| rider_grant_busy_emit_strip | BIT | woc_market_escrow_queue | rider |
| rider_grant_account_guard_strip | BIT | woc_market_escrow_queue | rider |
| rider_grant_nonce_guard_strip | BIT | woc_market_escrow_queue | rider |
| rider_grant_started_truth_strip | BIT | woc_market_escrow_queue | rider |
| rider_busy_budget_strip | BIT | woc_market_service | rider |
| rider_busy_verdict_strip | BIT | woc_market_service | rider |
| rider_park_cap_strip | BIT | woc_market_local_ledgers | rider |
| rider_stamp_total_strip | BIT | woc_market_delivery | rider |
| rider_drain_rung_strip | BIT | woc_market_service | rider |
| rider_saturated_rung_strip | BIT | woc_market_service | rider |
| rider_recorder_contended_strip | BIT | woc_market_directed_sql | rider |
| rider_clear_retry_strip | BIT | woc_market_directed_sql | rider |
| rider_merged_set_strip | BIT | woc_market_directed_sql | rider |
| rider_widening_strip_cancel | BIT | woc_market_directed_sql | rider |
| rider_routing_revert_touch | BIT | woc_market_directed_sql | rider |
| rider_narrowing_revert_bid | BIT | woc_market_directed_sql | rider |
| rider_deadlock_count_strip | BIT | woc_market_directed_sql | rider |
| rider_checkout_count_strip | BIT | woc_market_directed_sql | rider |
| rider_serialize_total_strip | BIT | woc_market_escrow_queue | rider |
| rider_highwater_count_strip | BIT | woc_market_delivery | rider |
| rider_comment_only_control | SURVIVED | woc_market_directed_sql | rider; deliberate no-op control |
| rider_pg_narrowing_negative_escrow | BIT | woc_market_delivery_pg_integration, woc_market_directed_sql | rider; SURVIVED its first scoring against the bond suite alone (that suite's freed-insert proof holds its own raw-client lock, so it cannot see the source's mode), upgraded by the KEY-SHARE-holder behavioral pin in b54a6e5b45 and re-scored against the owning suites |
| rider_pg_plain_bound_strip | BIT | woc_market_bond_pg_integration | rider |

Fix-round re-verifications (the stale-verdict rule: any mutant whose source
or pinning test was edited after its verdict re-runs before the log is
trusted), plus the two mutants the fix round's own code earned:

| mutant | verdict | suites | history |
|---|---|---|---|
| rider_park_cap_strip | BIT | woc_market_local_ledgers | rider; RE-RUN after the counted-refusal edit to the pinning test |
| rider_gate_cap_check | BIT | woc_market_escrow_gate | rider; RE-RUN after the probe rewrite |
| rider_gate_release_shift | BIT | woc_market_escrow_gate, woc_market_escrow_queue | rider; RE-RUN after the probe rewrite |
| rider_gate_reclaim_strip | BIT | woc_market_escrow_gate | rider; RE-RUN after the probe rewrite |
| rider_gate_probe_reclaim_strip | BIT | woc_market_escrow_gate | rider fix round; the saturated() probe's own reclaim (a bare stats read makes a full wedge permanent) |
| rider_accept_rungs_strip | BIT | woc_market_service | rider fix round; the directed acceptance's pre-burn saturation rung |

The qa-checklist round rewrote the gate onto identity-tokened holds and
added the pre-check refusal counting, superseding the five gate-region
mutants above (their regions no longer exist in that form) and earning two
new arms; all re-run against the rewritten source per the stale-verdict
rule:

| mutant | verdict | suites | history |
|---|---|---|---|
| rider_gate_cap_check_v2 | BIT | woc_market_escrow_gate | qa-checklist round; supersedes rider_gate_cap_check |
| rider_gate_release_delete_v2 | BIT | woc_market_escrow_gate, woc_market_escrow_queue | qa-checklist round; supersedes rider_gate_release_shift |
| rider_gate_reclaim_strip_v2 | BIT | woc_market_escrow_gate | qa-checklist round; supersedes rider_gate_reclaim_strip |
| rider_gate_probe_count_strip | BIT | woc_market_escrow_gate | qa-checklist round; the probe's refused counting (S2's gate half) |
| rider_gate_probe_reclaim_strip_v2 | BIT | woc_market_escrow_gate | qa-checklist round; supersedes rider_gate_probe_reclaim_strip |
| rider_custody_gatehold_strip_v2 | BIT | woc_market_escrow_queue | qa-checklist round; supersedes rider_custody_realm_gate_strip (the hold-handle form) |
| rider_wiring_emit_strip | BIT | woc_market_hot_reads | qa-checklist round; the pre-check's realm_refused emission (S2's wiring half) |

Rider totals: 32 distinct LIVE mutants (the five superseded gate rows
retire with their regions), 30 BIT, 1 deliberate green control, 1
first-scoring survivor upgraded to BIT in-round; every stale verdict
re-run after its source or pin moved. Whole log after this section: 325
distinct mutants.

## Escrow write-path rider QA section (run by the rider QA session)

Same protocol as the header, with two additions this round: every strip ran
in a THROWAWAY `git worktree` at the audited tip (so no mutation could touch
the tree the reviewer agents were reading, and no uncommitted work was ever
at risk from the `git checkout` revert), and no pg suite was involved, so
nothing could collide on the fixed database names.

INDEPENDENT SPOT-CHECKS of the rider's EXISTING pins, with the QA's own strip
designs rather than the logged ones (the 20 independent-spot-check protocol).
Where a logged row picked one site, this round deliberately picked a
different one, so a pin that only covers the logged site would surface.

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_narrowing_revert_accounts | BIT | woc_market_directed_sql | rider QA; the escrow ACCOUNTS clause, where the logged row used a bid clause |
| qa_routing_revert_clearlock | BIT | woc_market_directed_sql | rider QA; clearBuyNowLock leaves the bounded seam |
| qa_gate_cap_offbyone | BIT | woc_market_escrow_gate | rider QA; tryAcquire ONLY (the literal repeats in saturated(), caught by the occurrence assert and region-scoped) |
| qa_grant_account_guard_strip | BIT | woc_market_escrow_queue | rider QA; the ACCOUNT guard re-validated under the FIFO slot |
| qa_park_cap_offbyone | BIT | woc_market_local_ledgers | rider QA |
| qa_busy_budget_widen | BIT | woc_market_service | rider QA; the locked segment's bound widened to 99 |

PINS THIS ROUND ADDED, each given the strip it exists to catch (a new pin
that cannot fail is theatre):

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_help_string_drop_kind | BIT | game_metrics | rider QA; the HELP line loses a kind while the vocabulary pin stays green |
| qa_gate_gauge_frozen_sample | BIT | game_metrics | rider QA; the gate gauge sampled once instead of read live |
| qa_routing_hoisted_sql_writer | BIT | woc_market_directed_sql | rider QA; a `this.pool.query(IDENTIFIER)` writer, invisible to the leading-verb classifier before the totality assert |
| qa_grant_stamp_unarmed | BIT | woc_market_delivery | rider QA; the pendingGrants stamp stops arming the high-water watcher |
| qa_park_stat_leaves_guard | BIT | woc_market_delivery | rider QA; the standing-park stat moves out of its refusal guard |
| qa_gate_before_depth_cap | BIT | woc_market_escrow_queue | rider QA; the order swap that leaks a realm slot until the reclaim |
| qa_sibling_lock_unscanned_file | BIT | woc_market_directed_sql | rider QA; a lock clause planted in woc_market_stepup.ts, a sibling the OLD hand-kept five-file list never scanned |
| qa_hold_ceiling_widened | BIT | tunables | rider QA; 300_000 to 400_000, caught by the new upper bound |
| qa_accept_drain_rung_strip | BIT | woc_market_service | rider QA; the directed acceptance's OUTER drain rung, which had no coverage at all before this round |
| qa_create_drain_rung_sunk | BIT | woc_market_service | rider QA; createListing's drain rung sunk below the pooled health reads (region-scoped: the flat literal appears at BOTH entries, and the occurrence assert correctly refused the unscoped form) |

Rider QA totals: 16 distinct mutants, 16 BIT, 0 survivors, 0 controls. Whole
log after this section: 341 distinct mutants.

## Auth-guard rider section (run by the rider implement session)

Same protocol as the header: every strip occurrence-asserted, git-diff-proven,
run-proven by the Tests summary line, reverted by git checkout over the
committed tree with a clean-status verify after each row. One serial lane in
the throwaway worktree wocc-marketplace-authmut at the audited tip; the one
pg mutant ran ALONE with TEST_DATABASE_URL on the command line (the
fixed-database-name collision rule) while no other authguard-suite process
existed on the machine. Suites named per row are the OWNING suites the
verdict was scored against.

| mutant | verdict | suites | history |
|---|---|---|---|
| auth_core_expiry_strip | BIT | auth_guard_core, woc_auth_guard_cache | rider; the read-time expires_at re-check removed from tokenInfoFromRow (4 tests red across both suites) |
| auth_core_scope_allowlist_strip | BIT | auth_guard_core | rider; the fail-closed scope allowlist removed (every unrecognized-scope arm red) |
| auth_core_expiry_boundary_flip | BIT | auth_guard_core | rider; strictly-greater flipped to greater-or-equal, caught at the exact-instant pin |
| auth_core_suspension_clock_strip | BIT | auth_guard_core, woc_auth_guard_cache | rider; the suspension lapse compare made clock-free (a suspended row locked forever), caught by the row-not-result flip pins in BOTH suites |
| auth_core_ban_unlocked | BIT | auth_guard_core, woc_auth_guard_cache, woc_market_auth_guard_wiring | rider; the ban branch answers locked false (4 tests red incl. the pg-shaped ban message pin) |
| auth_cache_negative_install | BIT | woc_auth_guard_cache | rider; null probes installed as entries (7 tests red: the eviction-lever defense plus every count that assumed no negative caching) |
| auth_cache_lostbust_cancel_strip | BIT | woc_auth_guard_cache | rider; bust() stops cancelling the in-flight fetch, caught by the lost-bust install pin |
| auth_cache_ttl_ignored | BIT | woc_auth_guard_cache | rider; the TTL freshness gate forced true (stale entries serve forever), caught by the TTL-refetch and no-stale-serve pins |
| auth_cache_dead_entry_kept | BIT | woc_auth_guard_cache | rider; the expired-at-read-time entry drop removed, caught by the entries-after-expiry pin |
| auth_cache_account_bust_tokens_strip | BIT | woc_auth_guard_cache, woc_market_auth_guard_wiring | rider; bustAccount stops dropping the account's indexed tokens (the prefix over-bust arm red in the unit suite and at the route level) |
| auth_cache_single_flight_strip | BIT | woc_auth_guard_cache | rider; concurrent readers each start their own fetch |
| auth_bust_revoke_companion_strip | BIT | auth_guard_bust_coverage | rider; revokeCompanionToken's bust call removed, the discovery reconciliation reds (pg twin: the same strip reds woc_market_authguard_pg_integration's over-bust proof) |
| auth_bust_moderate_account_strip | BIT | auth_guard_bust_coverage | rider; moderateAccount's post-commit bust removed, the discovery reconciliation reds |
| auth_wiring_override_precedence_flip | BIT | woc_market_auth_guard_wiring | rider; the runtime cache outranks the test override, caught by the precedence pin (a rig answered from a cache it cannot see) |
| auth_wiring_readout_stat_strip | BIT | woc_market_hot_reads | rider; the authGuard stats field dropped from the stuck readout merge literal |
| auth_scan_shadow_writer_planted | BIT | auth_guard_bust_coverage | rider; a NEW unbusted `UPDATE accounts SET banned_at` writer planted in db.ts, proving the discovery scan reds on a writer no hand list knows about |
| auth_pg_token_qual_strip | BIT | woc_market_authguard_pg_integration | rider; the `expires_at > now()` qual dropped from the real probe SQL, caught by the expired-row refusal against real rows (pg lane, ran alone) |
| auth_comment_only_control | SURVIVED | auth_guard_core, woc_auth_guard_cache, auth_guard_bust_coverage, woc_market_auth_guard_wiring | rider; deliberate no-op control (comment edit), all 47 tests green |

Auth-guard rider totals: 18 distinct mutants, 17 BIT, 1 deliberate green
control, 0 unexplained survivors. Whole log after this section: 359 distinct
mutants.

Fix-round re-verifications (the stale-verdict rule: the fix round
f0dc5f48d1 edited the discovery suite and the suspension-TTL cache test, so
every mutant scored against an edited pin re-ran at that tip):

| mutant | verdict | suites | history |
|---|---|---|---|
| auth_cache_ttl_ignored | BIT | woc_auth_guard_cache | rider; RE-RUN after the exact-fetch-count rewrite of the suspension-TTL test |
| auth_bust_revoke_companion_strip | BIT | auth_guard_bust_coverage | rider; RE-RUN after the discovery-window hardening |
| auth_bust_moderate_account_strip | BIT | auth_guard_bust_coverage | rider; RE-RUN after the discovery-window hardening |
| auth_scan_shadow_writer_planted | BIT | auth_guard_bust_coverage | rider; RE-RUN after the discovery-window hardening |

Auth-guard rider totals stand: 18 distinct live mutants, 17 BIT, 1 green
control; 4 stale-verdict re-runs all BIT. Whole log unchanged at 359
distinct mutants.

The review round's fix commits (98813d67a2 the four-lane findings,
02108093eb the ledger pin) rewrote the install condition and edited most of
the pinning suites, so the affected verdicts re-ran at 02108093eb and the
round's own code earned its mutants:

| mutant | verdict | suites | history |
|---|---|---|---|
| auth_veto_strip | BIT | woc_auth_guard_cache | review fix round; the install veto removed, the account-bust race test reds |
| auth_ledger_floor_pass_strip | BIT | woc_auth_guard_cache | review fix round; the prune's oldest-first cap pass removed, the burst pin reds |
| auth_bust_token_as_flush | BIT | woc_auth_guard_cache | review fix round; bustToken widened to a flush, the stranger-survivor pin reds |
| auth_scan_upsert_planted | BIT | auth_guard_bust_coverage | review fix round; an unbusted INSERT INTO accounts ON CONFLICT DO UPDATE SET banned_at writer planted, the upsert arm discovers it |
| auth_bust_above_commit | BIT | auth_guard_bust_coverage | review fix round; a bust hoisted above its COMMIT, the structural order pin reds |
| auth_gauge_series_strip | BIT | game_metrics | review fix round; the entries series dropped from the prometheus gauge |
| auth_listener_bust_strip | BIT | woc_market_hot_reads | review fix round; the quota listener's onChange bust removed, the count-2 wiring pin reds |
| auth_cache_negative_install_v2 | BIT | woc_auth_guard_cache | review fix round; supersedes auth_cache_negative_install (its region was rewritten by the veto fix); 7 tests red |
| auth_cache_lostbust_cancel_strip | BIT | woc_auth_guard_cache | RE-RUN at 02108093eb |
| auth_cache_ttl_ignored | BIT | woc_auth_guard_cache | RE-RUN at 02108093eb; 3 tests red |
| auth_cache_dead_entry_kept | BIT | woc_auth_guard_cache | RE-RUN at 02108093eb |
| auth_cache_account_bust_tokens_strip | BIT | woc_auth_guard_cache | RE-RUN at 02108093eb; 2 tests red |
| auth_cache_single_flight_strip | BIT | woc_auth_guard_cache | RE-RUN at 02108093eb |
| auth_bust_revoke_companion_strip | BIT | auth_guard_bust_coverage | RE-RUN at 02108093eb |
| auth_bust_moderate_account_strip | BIT | auth_guard_bust_coverage | RE-RUN at 02108093eb |
| auth_scan_shadow_writer_planted | BIT | auth_guard_bust_coverage | RE-RUN at 02108093eb |
| auth_wiring_override_precedence_flip | BIT | woc_market_auth_guard_wiring | RE-RUN at 02108093eb |

Auth-guard rider totals after the review round: 25 distinct live mutants
(18 original, minus the superseded negative-install row, plus its v2, plus
the seven review-round mutants), 24 BIT, 1 deliberate green control, 0
unexplained survivors; every stale verdict re-run after its source or pin
moved. Whole log after this section: 366 distinct mutants.

The qa-checklist fix round (1f9f8aac4a: the derived veto-ledger floor and
the exercised flush lever) earned its own rows and re-ran the floor-pass
verdict at that tip:

| mutant | verdict | suites | history |
|---|---|---|---|
| auth_ledger_floor_regressed | BIT | woc_auth_guard_cache | qa-checklist round; the min-age floor dropped back to 20_000, under the driver backstop, caught by the db-deadline relation pin |
| auth_flush_lever_gutted | BIT | woc_auth_guard_cache | qa-checklist round; bustWocAuthGuardAll emptied, caught by the singleton-wiring exercise |
| auth_ledger_floor_pass_strip | BIT | woc_auth_guard_cache | RE-RUN at 1f9f8aac4a after the floor constants moved |

Auth-guard rider final totals: 27 distinct live mutants, 26 BIT, 1
deliberate green control, 0 unexplained survivors. Whole log after this
section: 368 distinct mutants.

## Auth-guard rider QA section (run by the rider QA session)

Same protocol as the header. Venue: the throwaway worktree
wocc-marketplace-authmut, one serial lane; the pg rows ran ALONE with
TEST_DATABASE_URL on the command line while no other authguard-suite process
existed. The QA's independent spot-checks (the 20 protocol: the QA's OWN
strip designs at DIFFERENT sites than the logged rows) ran first at the
audited tip e26c3ed9ec; the QA fix round (27262d293d + 7dd34268a8) then
edited most pinning suites, so every spot-check whose owning suite moved
re-ran at 7dd34268a8 (all re-BIT), and the fix round's own pins earned
their mutants at that tip.

Independent spot-checks (own designs, different sites than the logged rows):

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_expiry_compute_frozen | BIT | auth_guard_core, woc_auth_guard_cache, token_scope_db | rider QA; expiresAtMs > nowMs frozen to > 0 (the compute keeps the shape but ignores the clock); re-run at 7dd34268a8, 4 red |
| qa_scope_allowlist_widened | BIT | auth_guard_core, token_scope_db | rider QA; a phantom third scope 'admin' admitted past the allowlist, caught by the fail-closed it.each arm; re-run at 7dd34268a8 |
| qa_join_cancelled_flight | BIT | woc_auth_guard_cache | rider QA; read() joins CANCELLED flights again, caught by the lost-bust post-bust-reader pin; re-run at 7dd34268a8 |
| qa_veto_tie_flip | BIT | woc_auth_guard_cache | rider QA; the install veto's tie flipped to allow (bustAt <= startedAt installs), caught by the frozen-clock race pin; re-run at 7dd34268a8 |
| qa_mute_bust_removed | BIT | auth_guard_bust_coverage | rider QA; muteAccountChat's bust removed (the logged rows removed moderateAccount's and revokeCompanionToken's); re-run at 7dd34268a8 |
| qa_shutdown_flush_removed | BIT | woc_market_hot_reads | rider QA; the wocAuthGuardCache.bustAll() shutdown line removed, caught by the production-wiring source pin (suite unedited by the fix round; the e26c3ed9ec verdict stands) |
| qa_readtoken_bust_removed | BIT | woc_market_authguard_pg_integration | rider QA; revokeReadToken's bust removed, caught by the real writer-to-bust chain (pg lane, ran alone); re-run at 7dd34268a8 |

The QA round's discovery-scan probes (planted in the throwaway tree, each
reverted byte-identical) proved the shipped classifier red on the hoisted
module-scope SQL const (totality arm), the new-file writer, the buried
projection column in a long SET list, the second accounts DELETE, the
new-file upsert, and the class-method writer (attributed to the preceding
function, the fail-loud backstop), and proved TWO evasions: a
schema-qualified `public.auth_tokens` writer and a lowercase-keyword writer
both left every test green. The fix round closed both (widened
case-insensitive regexes plus synthetic-source self-probes) and banned the
interpolated-table shape outright; the rows below pin the closures.

Fix-round pins, each given the strip it exists to catch:

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_join_veto_strip | BIT | woc_auth_guard_cache | rider QA fix; the join re-check removed from read(), a post-bust arrival is answered from the pre-bust flight (the security lane's W1, executed live before the fix) |
| qa_veto_permanent | BIT | woc_auth_guard_cache | rider QA fix; the install veto made a permanent per-account blacklist, caught by the fence-release pin (2 red) |
| qa_ttl_anchor_late | BIT | woc_auth_guard_cache | rider QA fix; the entry TTL anchored at install time again, caught by the fetch-start anchor pin |
| qa_prune_gate_strip | BIT | woc_auth_guard_cache | rider QA fix; the prune amortization gate removed (every over-cap bust walks), caught by the one-pass counter pin |
| qa_retention_pass_strip | BIT | woc_auth_guard_cache | rider QA fix; the retention pass stops deleting, caught by the below-cap retention pin (2 red) |
| qa_floor_margin_regressed | BIT | woc_auth_guard_cache | rider QA fix; MIN_AGE dropped back to the marginless 70_000, caught by the +5s headroom relation pin |
| qa_scan_qualified_narrowed | BIT | auth_guard_bust_coverage | rider QA fix; the schema-qualifier arm stripped from the auth_tokens regex, caught by the synthetic-source probe |
| qa_scan_case_narrowed | BIT | auth_guard_bust_coverage | rider QA fix; the i flag stripped from the auth_tokens regex, caught by the lowercase synthetic probe |
| qa_scan_interp_table_neutered | BIT | auth_guard_bust_coverage | rider QA fix; INTERPOLATED_TABLE made never-match, caught by its positive controls |
| qa_scan_interp_window_strip | BIT | auth_guard_bust_coverage | rider QA fix; the guard-table window's interpolation check removed, caught by the accounts_interpolated synthetic probe |
| qa_gauge_softbound_series_strip | BIT | game_metrics | rider QA fix; the index/recent_busts series dropped from the prometheus collect |
| qa_pg_companion_account_qual_strip | BIT | woc_market_authguard_pg_integration | rider QA fix; revokeCompanionToken's account qual neutered (OR TRUE), caught by the new same-prefix stranger survivor (pg lane, ran alone) |

Stale-verdict re-runs (the fix round edited auth_guard_core,
woc_auth_guard_cache, auth_guard_bust_coverage, woc_market_auth_guard_wiring,
game_metrics, and the authguard pg suite, so every logged mutant scored
against one of them re-ran at 7dd34268a8): auth_core_expiry_strip,
auth_core_scope_allowlist_strip, auth_core_expiry_boundary_flip,
auth_core_suspension_clock_strip, auth_core_ban_unlocked,
auth_cache_negative_install_v2, auth_cache_lostbust_cancel_strip,
auth_cache_ttl_ignored, auth_cache_dead_entry_kept,
auth_cache_account_bust_tokens_strip, auth_cache_single_flight_strip,
auth_veto_strip, auth_ledger_floor_pass_strip, auth_bust_token_as_flush,
auth_ledger_floor_regressed, auth_flush_lever_gutted,
auth_bust_revoke_companion_strip, auth_bust_moderate_account_strip,
auth_scan_shadow_writer_planted, auth_scan_upsert_planted,
auth_bust_above_commit, auth_wiring_override_precedence_flip,
auth_gauge_series_strip (DB-free), and auth_pg_token_qual_strip (pg lane,
alone): ALL 24 re-BIT, every revert byte-identical. The two rows whose
owning suites the fix round left untouched (auth_wiring_readout_stat_strip,
auth_listener_bust_strip, both woc_market_hot_reads) stand on their
1f9f8aac4a verdicts.

Rider QA totals: 19 distinct new live mutants (7 spot-checks + 12 fix-round
pins), 19 BIT, 0 survivors, 0 controls; 24 stale-verdict re-runs all BIT.
Rider cumulative: 46 distinct live mutants, 45 BIT, 1 deliberate green
control. Whole log after this section: 387 distinct mutants.

The QA round's own fix was re-reviewed FRESH (the fix-rounds-are-unreviewed
rule) and the reviewer executed a DEFEAT of the first join guard: the veto
ledger keeps only the LAST bust per account, so a second same-account bust
landing after a joiner overwrote the timestamp the joiner's arrival-time
comparison consulted, and the pre-bust row was accepted. The second fix
(7b6e0badb0) widens the join guard to the install veto's own condition
(any bust at or after flight start makes every joiner refetch; the recorded
once-per-flight stale answer now covers the flight CREATOR only), deepens
the install freeze one level, and pins both. Its rows, plus the third
stale-verdict block (the cache suite was edited again, so every mutant it
scores re-ran at 7b6e0badb0):

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_join_guard_lastbust_overwrite | BIT | woc_auth_guard_cache | rider QA fix 2; the joiner-arrival narrowing reintroduced (the defeated first-fix form), caught ONLY by the new double-bust interleaving pin (1 red) |
| qa_freeze_strip | BIT | woc_auth_guard_cache | rider QA fix 2; the install freeze removed, caught by the isFrozen pin |

Third stale-verdict block at 7b6e0badb0, all re-BIT, reverts byte-identical:
qa_join_veto_strip (2 red: both join pins), qa_veto_permanent,
qa_ttl_anchor_late, qa_prune_gate_strip, qa_retention_pass_strip,
qa_floor_margin_regressed, auth_core_expiry_strip,
auth_core_suspension_clock_strip, auth_core_ban_unlocked,
auth_cache_negative_install_v2, auth_cache_lostbust_cancel_strip,
auth_cache_ttl_ignored, auth_cache_dead_entry_kept,
auth_cache_account_bust_tokens_strip, auth_cache_single_flight_strip,
auth_veto_strip, auth_ledger_floor_pass_strip, auth_bust_token_as_flush,
auth_ledger_floor_regressed, auth_flush_lever_gutted, and the spot-checks
qa_expiry_compute_frozen, qa_join_cancelled_flight, qa_veto_tie_flip
(23 re-runs). Rows owned by suites the second fix did not touch stand on
their 7dd34268a8 verdicts.

Rider QA final totals: 21 distinct new live mutants (7 spot-checks + 14
fix-round pins, two of them pg), 21 BIT, 0 survivors, 0 controls; 47
stale-verdict re-runs across the two fix rounds, all BIT. Rider
cumulative: 48 distinct live mutants, 47 BIT, 1 deliberate green control.
Whole log after this section: 389 distinct mutants.

The qa-checklist round (verdict READY, 0 blocking) closed with commit
3e77e6f44e: the joiner-termination pin (its adversarial pass named the
unpinned invariant), the join-veto refetch counter with its gauge series,
the accessor fold-in, and message/comment honesty fixes. Its rows, plus
the FINAL stale-verdict block (the cache, discovery, metrics, and pg
suites were edited again, and main.ts moved near the readout pin's
region, so every mutant scored against any of them re-ran at 3e77e6f44e):

| mutant | verdict | suites | history |
|---|---|---|---|
| qa_flight_cleanup_strip | BIT | woc_auth_guard_cache | qa-checklist round; the flight registration's settle cleanup disabled, the vetoed joiner re-joins the flight it just left and the suite dies FATALLY red (worker heap OOM from the promise spin the termination pin documents); a fatal red, not a survivor |
| qa_gauge_joinveto_series_strip | BIT | game_metrics | qa-checklist round; the join_veto refetch series dropped from the prometheus collect |

Final stale-verdict block at 3e77e6f44e, ALL re-BIT, reverts
byte-identical: the 25 cache/core-scored rows (the round-two list plus
qa_join_guard_lastbust_overwrite and qa_freeze_strip), the 10
discovery-scan rows, the 2 gauge rows, auth_wiring_readout_stat_strip
(main.ts region adjacent), and the 2 pg rows (alone in their lane).
Three stale-verdict blocks across the QA's fix rounds total 93 re-run
events, every one BIT.

Rider QA closing totals: 23 distinct new live mutants (7 independent
spot-checks + 16 fix-round pins, two pg among them), 23 BIT (one by
fatal red), 0 survivors, 0 controls. Rider cumulative: 50 distinct live
mutants, 49 BIT, 1 deliberate green control, 0 unexplained survivors.
Whole log after this section: 391 distinct mutants.

## Devnet dry-run section (21): the service price-source pins

Run 2026-08-20 in a throwaway SERVICE-repo worktree at 2eedcfb (deps
symlinked from the primary worktree; baseline 55/55 green across
market_bootstrap + market_dev_chain), each mutant occurrence-asserted
(exactly one match before the edit), run-proven (55 tests reported in
every mutated run), and reverted byte-identical (git diff --quiet after
checkout; worktree deleted after the batch). These pins guard the two
service changes the ruled devnet plan landed, both money-relevant (a
mispriced venue prices real sales): the venue mint split
(WOC_MARKET_PRICE_MINT) and the fixed dev price decoupled from the
fake-chain gate.

| mutant | verdict | suites | history |
|---|---|---|---|
| m21_pricemint_refusal_strip | BIT (1 fail) | market_bootstrap | the set-but-invalid WOC_MARKET_PRICE_MINT refusal disabled (condition prefixed false); 'a mistyped price mint override refuses to construct' red on its named assertion |
| m21_pricemint_override_ignored | BIT (2 fails) | market_bootstrap | marketPriceMint collapsed to the WOC_MINT chain; the precedence pin AND the captured-request pin (the address parameter must carry the override) both red |
| m21_devprice_gate_always_on | BIT (1 fail) | market_dev_chain | the NODE_ENV allowlist gate removed (if false); 'the dev price venue is refused outside an affirmed dev or test NODE_ENV' red, failing-test name captured in a dedicated re-run |
| m21_devprice_recoupled | BIT (2 fails) | market_dev_chain + market_bootstrap | the old devChainEnabled gate restored; the dev-NODE_ENV-alone arm and the real-chain fixed-price bootstrap pin both red |

Section totals: 4 distinct mutants, 4 BIT, 0 survivors. Whole log after
this section: 395 distinct mutants.

The 21 review fix round (service commit 6c1b01f) edited both scored files
and RENAMED the refusal test (now 'the price mint override: shape, decode,
and NODE_ENV refusals; a valid dev one builds'; the first table's row also
truncated the old name, which was 'a mistyped price mint override refuses
to construct; a valid one builds': recorded here as the correction).
Stale-verdict block at 6c1b01f, fresh throwaway worktree, baseline 57/57,
all four re-run and re-BIT, reverts byte-identical: m21_pricemint_refusal_strip
(as the rewritten screen line, 1 fail), m21_pricemint_override_ignored
(2 fails: precedence + captured-request), m21_devprice_gate_always_on
(1 fail on the renamed gate test), m21_devprice_recoupled (3 fails: the
gate test plus BOTH bootstrap fixed-price arms, the confinement positive
control now also depending on the decoupling). New pins from the fix
round, same protocol:

| mutant | verdict | suites | history |
|---|---|---|---|
| m21_confinement_strip | BIT (1 fail) | market_bootstrap | the dev-price + live-arm + live-default-mint refusal disabled; 'confinement: a fixed dev price refuses the LIVE mint on the live chain arm' red on its named negative arm |
| m21_pricemint_prodgate_strip | BIT (1 fail) | market_bootstrap | the NODE_ENV allowlist refusal on a SET override disabled; the renamed refusal test red at its first mutated-guard arm (no-NODE_ENV; the production arm guards the same line and is reached only on a run where the first arm passes) |
| m21_wocmint_screen_strip | BIT (1 fail) | market_bootstrap | the chain-mint shape+decode screen disabled; 'a mistyped WOC_MINT refuses to construct instead of crashing the boot' red |

Section totals after the fix round: 7 distinct mutants (4 + 3), all BIT,
0 survivors; 4 stale-verdict re-run events all re-BIT. Whole log: 398
distinct mutants.

The second fix round (service commit 8db7734, the re-review round: widened
confinement, warns moved below the last refusal, both walls pinned) edited
bootstrap and both bootstrap-scored suites again. Fresh throwaway worktree
at 8db7734, baseline 64/64 across the three scored suites (compose
conformance joined), every mutant occurrence-asserted, run-proven (64
reported per run), reverts byte-identical, worktree deleted. The
confinement mutant was RE-SCORED against the widened predicate (its old
needle no longer exists): m21_confinement_strip now strips the unified
(devPrice OR venue-split) live-default-mint refusal and bites through the
confinement test (1 fail). Stale-verdict re-runs, all re-BIT:
m21_pricemint_refusal_strip (1), m21_pricemint_override_ignored (4 fails
now: precedence, captured-request, the MIRROR confinement arm, and the
split-warn naming, all downstream of the collapsed override),
m21_pricemint_prodgate_strip (1), m21_wocmint_screen_strip (1),
m21_devprice_gate_always_on (1), m21_devprice_recoupled (4 fails: the
gate test plus every fixed-price-dependent bootstrap arm). New pins:

| mutant | verdict | suites | history |
|---|---|---|---|
| m21_fixed_warn_strip | BIT (1 fail) | market_bootstrap | the fixed-price boot warn branch disabled; 'both price splits warn at boot' red on the fixed-count assert |
| m21_split_warn_strip | BIT (1 fail) | market_bootstrap | the venue/chain mint-split warn branch disabled (else-if false); the same test red on the split-count assert, proving the two branches die independently |
| m21_compose_devwall_revert | BIT (1 fail) | compose_conformance | WOC_MARKET_DEV_CHAIN reverted from the pinned "" to env forwarding; 'the deployed economy service pins BOTH dev knobs EMPTY' red |

Section totals after the second fix round: 10 distinct mutants (4 + 3 + 3,
one re-scored in place), all BIT, 0 survivors; stale-verdict re-run events
4 + 6 = 10, all re-BIT. Whole log: 401 distinct mutants.

## Close-out prep rider section (run by the rider implement session)

The 19/22 cross-repo ask's SERVICE half (commit 2c4a261 on
integration/woc-market-settlement): the admin overview gains wocDecimals
(read from the wired settlement config through
MarketSettlementService.configuredWocDecimals, never env) and every
volume window gains settledBase (the payer-total base-unit sum). New
money pins at the 20 protocol: mutants applied to the CLEAN committed
tree at 2c4a261, each run reporting the full 604-test count (tests
proven RAN), reverts via git restore (byte-identical by construction),
git status clean before and after every run. The pg-scored mutant ran
the full suite with CLAUDIUM_TEST_DATABASE_URL on the command line
(604/604 zero skips baseline).

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_settledbase_mem_leg_swap | BIT (1 fail) | market_http | the in-memory sum reads q.seller.base instead of q.amount.base; 'the overview reports price health, fee schedule, volume and bond exposure' red on the settledBase absolute pin (90k vs 100k tokens at 9 decimals) |
| mrc_settledbase_pg_col_swap | BIT (1 fail) | market_store_pg (pg tier) | the SQL sums seller_base instead of amount_base; 'postgres: quotes survive a restart, supersede correctly, and aggregate in SQL' red on the settledBase literal ('90000000000000' vs '100000000000000') |
| mrc_wocdecimals_hardcode | BIT (2 fails) | market_http + market_bootstrap | configuredWocDecimals returns 6 instead of the wired config; the overview http pin (rig wires 9, env empty) and the bootstrap wired-decimals pin both red |
| mrc_wocdecimals_env_copy | BIT (2 fails) | market_http + market_bootstrap | admin.ts reads Number(env.WOC_DECIMALS ?? 6) instead of the service accessor; the http pin red (env empty reports 6, rig wired 9) and the bootstrap nonsense arm red (NaN vs the wired 6) |

The DASHBOARD half (commit 53913d7 on integration/woc-market-trading):
the Trading tab prefers the reported wocDecimals through
effectiveWocDecimals, legsReconcile upgrades to the real sum
reconciliation on a reported settledBase, and the loader screens a
garbled decimals leaf. Same protocol: clean committed tree at 53913d7,
every run reporting the full 279-test count, git restore reverts,
status clean before and after.

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_dash_prefer_strip | BIT (2 fails) | market_trading_view + market_trading_panel_dom | effectiveWocDecimals returns the constant unconditionally; the preference arms and the DOM reported-9 render + banner test both red |
| mrc_dash_reconcile_strip | BIT (1 fail) | market_trading_view | legsReconcile returns true after the sanity floor, ignoring settledBase; the sum-reconciliation test red on its one-base-unit-off arm |
| mrc_dash_screen_strip | BIT (1 fail) | market_summary_load | the wocDecimals screen arm replaced with true; the object-valued-leaf test red on its six garbled-decimals payloads |

The R16 CI wiring (game commit 462c234031): the per-leg Postgres service
and job-level TEST_DATABASE_URL in the two shard gates and nightly,
pinned by the new counted assertions in tests/ci_workflow.test.ts. One
mutant at the same protocol (clean committed tree, run-proven at the
suite's 26 reported tests, git restore revert, status clean after):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_ci_envline_strip | BIT (1 fail) | ci_workflow | the pr-gate job-level env block deleted from ci.yml; the counted job-env pin (exactly two copies) red |

The FIX ROUND (service 06f6725, dashboard e37cd02 + 43457cb: the bond
exclusion pin, the banner reword, windowReconcileNote, the 40-digit
parse cap, the overview-down composition test). New pins, same protocol
(clean committed trees, run-proven at the full reported counts, git
restore reverts, status clean after):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_settledbase_kind_filter_strip | BIT (1 fail) | market_http | the in-memory volume filter drops the kind qual so the settled bond enters the sums; the overview test red on the unchanged-settledBase pin |
| mrc_dash_parse_cap_revert | BIT (1 fail) | market_trading_view | MONEY_BASE_RE reverted from {1,40} to +; the 41-digit refusal arms red |
| mrc_dash_note_branch_strip | BIT (1 fail) | market_trading_view | windowReconcileNote's absent-total branch removed; the sanity-floor-note arm red |

The GATE FIX ROUND (game commit 0343ed9271): the gate-integrity review
EXECUTED a defeat of the first counted wiring pin (relocating both
service blocks onto vitest-free jobs kept the file-wide counts green
while re-skipping the battery), so the pin was rebuilt on per-job spans
and tests/ci_pg_presence.test.ts joined as the runtime twin. The
relocation is now a logged mutant and the original strip verdict was
re-run against the rebuilt pin (verdicts go stale when a pin is
edited). Same protocol; the relocation mutant was applied by script
(delete from pr-gate, insert byte-identical into lint) so the OLD pin
would have stayed green on it:

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_ci_block_relocation | BIT (1 fail) | ci_workflow | pr-gate's services+env block moved verbatim onto lint (file-wide counts unchanged); the pr-gate span assertion red |
| mrc_ci_envline_strip (re-run) | re-BIT (1 fail) | ci_workflow | the original strip re-run against the span pin after the rewrite |

Also proven red-first in the same round (a repair, not a mutant): the
client perf pg suite against a VIRGIN database (1 fail on the
worst-10s index assert before adding runConcurrentIndexMigrations to
its beforeAll; 5/5 after; probe database dropped).

The SECOND FIX ROUND (service commit 52fa0c2 on top of 06f6725: the pg
kind-pin bond + heldUsdCents; dashboard dfd0f4d: the decisive 41-digit
sum fixture, the quoteLegsMismatch cap arm, the DOM note pin, the
banner sentence, the single-call JSX). New pins, same protocol; the two
dashboard parse mutants were applied by script against the COMMITTED
tree after the earlier uncommitted-revert slip ate a comment edit
twice (re-applied both times; the lesson is re-learned: commit before
mutating):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_settledbase_pg_kind_qual_strip | BIT (1 fail) | market_store_pg (pg tier) | the aggregate SQL's kind qual removed so the settled kind-pin bond enters the sums; the totals pins red |
| mrc_dash_legsreconcile_uncap | BIT (1 fail) | market_trading_view | legsReconcile's local parse reverted to the uncapped inline regex; the exact-41-digit-sum fixture red (uncapped, it reconciles true) |
| mrc_dash_quotelegs_uncap | BIT (1 fail) | market_trading_view | quoteLegsMismatch's local parse reverted the same way; the over-length not-applicable arm red |

The GATE HARDENING ROUND (game commit 1fd4692460): the fresh gate
review executed two more defeats (a shard-matrix split onto a new job
evaded the hand-listed pin; the 5433 dead-letter guard had narrowed to
per-span), so the pin now DERIVES the vitest-running job set with
guard-coupled exemptions, the 5433 negatives are file-wide again, and
the runtime sentinel joined CI_GUARD_SUITES with an honest local skip.
COMMITTED BEFORE MUTATING this time; every prior CI-pin verdict re-run
(verdicts stale on pin edit):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_ci_matrix_split_new_job | BIT (5 fails) | ci_workflow | pr-gate cloned as pr-gate-b WITHOUT the DB block (the exact prior evasion); the derived set equality and the span asserts red |
| mrc_ci_5433_sneaky_service | BIT (1 fail) | ci_workflow | a postgres service mapping 5433:5432 added to pr-checks; the restored file-wide dead-letter negative red |
| mrc_ci_lane_gating_control | BIT (1 fail) | ci_workflow | a TEST_DATABASE_URL read appended to the first CI_LONG_SUITES file; the lane-exemption coupled guard red |
| mrc_ci_block_relocation (re-run) | re-BIT (1 fail) | ci_workflow | the lint relocation against the derived-set pin |
| mrc_ci_envline_strip (re-run 2) | re-BIT (1 fail) | ci_workflow | the pr-gate env strip against the derived-set pin |

Section totals: 18 distinct mutants (6 service + 7 dashboard + 5 CI),
all BIT, 0 survivors; 3 stale-verdict re-run events, all re-BIT. Whole
log: 419 distinct mutants.

## Close-out prep rider QA section (run by the rider QA session, 2026-08-20)

The QA's OWN strips per the 20 protocol (the implement log never
substitutes for the QA's mutants): committed trees only (service 52fa0c2
then d9a4f9b, dashboard dfd0f4d then c0e99d2, game 2b9f583b2f), every run
reporting the full suite count, git checkout reverts, status clean before
and after every run; pg-scored runs with CLAUDIUM_TEST_DATABASE_URL (or
TEST_DATABASE_URL for the game battery) on the command line only.

SERVICE spot-checks. Two of the QA's strips SURVIVED the shipped pins and
became new tests in d9a4f9b; both re-scored BIT after the fix:

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_settledbase_window_strip | SURVIVED at 52fa0c2 (604/597/0); BIT (1 fail of 605) at d9a4f9b | market_store_pg (memory arm) | the memory volumeTotals window qual deleted: every suite stayed green because no fixture held a settled row outside a queried window, so all three overview windows silently agree; the new two-day-old settlement test reds it |
| mrc_wocdecimals_falsy_coerce | SURVIVED at 52fa0c2; BIT (1 fail of 605) at d9a4f9b | market_bootstrap | the payload accessor coerced with OR-6: only 9 and nonsense were pinned, so the falsy valid zero fell back silently; the decimalsAt zero arm reds it |
| mrc_wocdecimals_payload_delete | REFUSED AT COMPILE (tsc TS2741) | build | deleting the payload line cannot ship: MarketAdminOverview requires the field; recorded as a type-level refusal, not counted as a scored mutant |
| mrc_wocdecimals_hardcode (re-run) | re-BIT (2 fails of 605) | market_http + market_bootstrap | pin file edited this round, verdict re-proven |
| mrc_settledbase_pg_col_swap (re-run) | re-BIT (1 fail of 605, pg tier zero skips) | market_store_pg | pin file edited this round |
| mrc_settledbase_pg_kind_qual_strip (re-run) | re-BIT (1 fail of 605, pg tier zero skips) | market_store_pg | pin file edited this round |

DASHBOARD spot-checks. Two strips SURVIVED and became new pins in c0e99d2;
both re-scored BIT:

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_dash_clamp_zero | SURVIVED at dfd0f4d (281/281); BIT (1 fail of 282) at c0e99d2 | market_trading_view | safeWocDecimals lower bound tightened to positive: a reported zero silently re-scales by the constant; the decimals-0 pins red it |
| mrc_dash_banner_direction | SURVIVED at dfd0f4d; BIT (1 fail of 282) at c0e99d2 | woc_mint | the banner equality widened to at-most: every existing fixture sat above the constant so the below-constant half was silence; the reported-3 and reported-0 arms red it |
| mrc_dash_cap_41 | BIT at dfd0f4d (1 fail of 281); re-BIT (1 fail of 282) at c0e99d2 | market_trading_view | the 40-digit cap widened by one: the exact-41-digit-sum fixture is decisive both before and after the pin-file edit |
| mrc_dash_legsreconcile_uncap (re-run) | re-BIT (1 fail of 282) | market_trading_view | pin file edited this round |
| mrc_dash_screen_strip (re-run) | re-BIT (1 fail of 282) | market_summary_load | pin file edited this round |
| mrc_dash_prefer_strip (re-run) | re-BIT (2 fails of 282) | market_trading_view + market_trading_panel_dom | pin file edited this round |

THE CI PIN, SHAPE FOUR (game 2b9f583b2f). The QA's gate review EXECUTED a
third-shape defeat (a cloned shard job whose run line is a block scalar is
invisible to a run-line recognizer while half the matrix loses its
database), so the pin was rebuilt as a complete job classification (every
job key pg-wired, guarded DB-less, or test-free; token-scan cross-checks;
sentinel WOCC_EXPECT_PG pinned beside the URL). Control 26/26 green;
every prior CI verdict re-run per the stale rule; THIRTEEN mutants, all
BIT at the full 26-test count:

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_ci_envline_strip (re-run 3) | re-BIT (1 fail) | ci_workflow | pr-gate env block deleted; the span env regexes red |
| mrc_ci_block_relocation (re-run 2) | re-BIT (1 fail) | ci_workflow | services+env moved verbatim onto lint; pr-gate span asserts red |
| mrc_ci_matrix_split_new_job (re-run) | re-BIT (3 fails) | ci_workflow | pr-gate cloned inline without the DB block; completeness reds the unclassified key |
| mrc_ci_blockscalar_split | BIT (2 fails) | ci_workflow | the gate review's measured defeat replayed: the clone's run line as a block scalar; completeness reds it where the run-line recognizer stayed green |
| mrc_ci_npm_script_job | BIT (2 fails) | ci_workflow | a new job runs npm run test:pg; completeness reds the unclassified key |
| mrc_ci_quoted_job_key | BIT (1 fail) | ci_workflow | a quoted "pr-pg" job running npm test; the widened key regex collects it and completeness reds it |
| mrc_ci_5433_sneaky_service (re-run) | re-BIT (1 fail) | ci_workflow | unquoted 5433 mapping on pr-checks; the file-wide negative reds |
| mrc_ci_5433_quoted | BIT (1 fail) | ci_workflow | the QUOTED "5433:5432" mapping that dodged the shipped matcher; the widened port matcher with positive controls reds it |
| mrc_ci_sentinel_strip | BIT (1 fail) | ci_workflow | WOCC_EXPECT_PG deleted from pr-gate; the sentinel span regex reds |
| mrc_ci_expression_run | BIT (1 fail) | ci_workflow | an expression-valued run line added to lint; the novelty refusal reds |
| mrc_ci_testfree_gains_vitest | BIT (4 fails) | ci_workflow | a vitest step added to pr-checks; the test-free token cross-check reds |
| mrc_ci_lane_gating_control (re-run) | re-BIT (1 fail) | ci_workflow | TEST_DATABASE_URL read appended to the first CI_LONG_SUITES file |
| mrc_ci_browser_gating_control | BIT (1 fail) | ci_workflow | TEST_DATABASE_URL read appended to a tests/browser file; the browser coupled guard reds |

The runtime twin was proven live both ways at 2b9f583b2f: armed via
WOCC_EXPECT_PG=1 with no TEST_DATABASE_URL it FAILS; with the URL it
passes; locally unarmed it reports SKIPPED.

CONCURRENCY PROBE (not a mutant; the gate review's minimum ask): the full
pg battery (17 suites, 333 tests) run THREE times as one parallel vitest
invocation against a virgin database, all green; recorded with the widened
watch item in follow-ups.md 5.3.

THE SECOND HARDENING ROUND (game 1e932c5b61): the FRESH review of the
shape-four fix proved three residual doors (an unguarded dbless
classification, a step-level env override blanking legs under a satisfied
job-level pin, an unclassifiable job-level uses) plus spelling gaps; all
closed. Four new mutants, and per the stale rule all thirteen prior CI
verdicts re-run against the hardened pin (control 26/26 green; every run
at the full count; git checkout reverts; status clean):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_ci_step_env_override | BIT (1 fail) | ci_workflow | a step-level TEST_DATABASE_URL: '' under pr-gate's run step; the exactly-one-occurrence count reds |
| mrc_ci_job_level_uses | BIT (2 fails) | ci_workflow | a reusable-workflow job added; completeness AND the uses novelty refusal red |
| mrc_ci_blockscalar_expression | BIT (1 fail) | ci_workflow | a run block-scalar whose line begins with an expression; the expression-initial refusal reds |
| mrc_ci_flow_style_job | BIT (1 fail) | ci_workflow | a flow-style job mapping; the unrecognized two-space-line refusal reds instead of swallowing it |
| all 13 first-round CI mutants (re-run) | re-BIT (fail counts 1 to 4) | ci_workflow | the full first-round battery replayed against 1e932c5b61 |

THE LATE REVIEWER ROUND (service 70b71b6, dashboard cff8102): the
stalled docs fix-round reviewer delivered AFTER the verdict and push;
its coverage nit predicted a survivor and was right. Applied at the 20
protocol (committed trees, full counts, git checkout reverts, status
clean):

| mutant | verdict | suites | history |
|---|---|---|---|
| mrc_settledbase_upper_bound_strip | BIT (1 fail of 605) | market_store_pg (memory arm) | the upper window arm dropped from the memory loop; before 70b71b6 every settled fixture sat at or below every queried toMs so this SURVIVED by prediction; the future-settled fixture reds it |
| mrc_settledbase_pg_upper_bound_strip | BIT (1 fail of 605, pg tier zero skips) | market_store_pg | the BETWEEN's upper arm neutralized with params preserved; the pg future-settled fixture reds the round-trip test |

Section totals: 19 new distinct mutants (4 service + 3 dashboard + 12 CI),
all BIT after the fix rounds, 0 standing survivors (the 4 initial survivor
verdicts plus the predicted upper-bound survivor are the findings, closed
by the new pins); 24 re-run events, all re-BIT; 1 compile-refused strip
recorded, not counted. Whole log: 438 by the chained convention (419 + 19). BOOKKEEPING CAVEAT for the 22
close-out: an independent name census over the log's table rows reads a
few higher than the chained totals (the early sections record some mutants
in prose, and the divergence predates this rider); reconcile once at
close-out if the ledger figure matters.
