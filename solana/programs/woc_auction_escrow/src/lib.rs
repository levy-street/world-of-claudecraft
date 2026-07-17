//! Non-custodial $WOC English-auction escrow for one SPL token.
//!
//! One program-owned vault backs each auction, keyed by an id, so the deposited
//! bids are a PDA only a program-signed CPI can move (no server hot key can ever
//! divert bidder money). The vault ATA authority IS the auction state PDA, exactly
//! like the match/season vaults in woc_escrow.
//!
//! The novel primitive is `place_bid`: it pulls the new bid into the vault AND
//! refunds the prior high bidder their exact prior bid in a single atomic
//! instruction. A program-signed CPI (authority = the auction PDA) does the
//! refund, the refund can only go to an account owned by the on-chain-recorded
//! high bidder, and after the swap the vault holds exactly the new high bid.
//!
//! Non-custodial guarantees:
//!  - Funds only leave the vault via a program-signed CPI: an outbid refund (to
//!    the recorded prior bidder), a settle payout (to the recorded seller minus a
//!    burned rake), a cancel refund (to the recorded high bidder), or a reclaim.
//!  - The settler (the realm key) can never route funds anywhere except the
//!    on-chain-recorded parties: seller on settle, high bidder on cancel.
//!  - `reclaim_expired` is a permissionless liveness valve: once the settler has
//!    had its window (ends_at + grace), anyone can drive the deterministic
//!    settle outcome, so a down settler key can never strand funds.
//!  - The burn rake is a constant-capped program constant (never an instruction
//!    argument), burned from the vault, not skimmed to a treasury.
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

declare_id!("GzkjHHkkJqZf5Qa3YZaJo1iHcKkxi4zUT5sV3zpVeyqZ");

/// Basis-point denominator for the rake and min-raise math.
pub const BPS_DENOMINATOR: u128 = 10_000;
/// Hard cap on the per-auction burn rake (10%). A program constant, never an
/// instruction argument, so no caller can set a confiscatory rake.
pub const MAX_RAKE_BPS: u16 = 1_000;
/// A new bid must beat the standing high bid by at least this (5%), matching the
/// sim's marketMinNextBid rule; a first bid instead has to meet min_bid.
pub const MIN_RAISE_BPS: u16 = 500;
/// Floor on an auction's remaining life at open time (5 minutes).
pub const MIN_DURATION_SECS: i64 = 300;
/// Ceiling on an auction's life at open time (7 days), to cap runaway auctions.
pub const MAX_DURATION_SECS: i64 = 7 * 24 * 3600;
/// The settler gets this long past ends_at before a permissionless reclaim is
/// allowed (24 hours), so a live settler always has the first window.
pub const RECLAIM_GRACE_SECS: i64 = 24 * 3600;

/// Burn rake on the winning bid: high_bid * rake_bps / 10_000. Pure and checked so
/// it can be unit-tested off-chain; the instruction maps `None` to `Overflow`.
fn compute_rake(high_bid: u64, rake_bps: u16) -> Option<u64> {
    let r = (high_bid as u128)
        .checked_mul(rake_bps as u128)?
        .checked_div(BPS_DENOMINATOR)?;
    u64::try_from(r).ok()
}

/// Minimum acceptable bid: the first bid must meet min_bid; every later bid must
/// beat the standing high bid by at least max(1, high_bid * MIN_RAISE_BPS / 10_000).
/// Pure and checked so it can be unit-tested off-chain.
fn compute_min_acceptable(min_bid: u64, high_bid: u64) -> Option<u64> {
    if high_bid == 0 {
        return Some(min_bid);
    }
    let raise = (high_bid as u128)
        .checked_mul(MIN_RAISE_BPS as u128)?
        .checked_div(BPS_DENOMINATOR)?;
    let raise = core::cmp::max(1u128, raise);
    let min_next = (high_bid as u128).checked_add(raise)?;
    u64::try_from(min_next).ok()
}

#[program]
pub mod woc_auction_escrow {
    use super::*;

    /// Open an English auction for one SPL lot. No token moves here (the seller
    /// stakes nothing; only bidders deposit). Creates the Auction PDA and its
    /// program-owned vault ATA. `seller` is passed explicitly (not derived from
    /// the signer) so a game server can open on a seller's behalf; the opener is
    /// the fee/rent payer and the seller only ever RECEIVES proceeds, validated
    /// against the recorded seller at settle. `mint` is the Mint account (as in
    /// woc_escrow), not a redundant instruction arg.
    pub fn open_auction(
        ctx: Context<OpenAuction>,
        auction_id: u64,
        seller: Pubkey,
        min_bid: u64,
        rake_bps: u16,
        buyout: u64,
        settler: Pubkey,
        ends_at: i64,
    ) -> Result<()> {
        require!(min_bid > 0, AuctionError::AmountZero);
        require!(rake_bps <= MAX_RAKE_BPS, AuctionError::RakeTooHigh);
        if buyout != 0 {
            require!(buyout >= min_bid, AuctionError::BadBuyout);
        }
        let now = Clock::get()?.unix_timestamp;
        let earliest = now
            .checked_add(MIN_DURATION_SECS)
            .ok_or(AuctionError::Overflow)?;
        let latest = now
            .checked_add(MAX_DURATION_SECS)
            .ok_or(AuctionError::Overflow)?;
        require!(
            ends_at >= earliest && ends_at <= latest,
            AuctionError::BadDuration
        );

        let a = &mut ctx.accounts.auction;
        a.auction_id = auction_id;
        a.mint = ctx.accounts.mint.key();
        a.seller = seller;
        a.settler = settler;
        a.min_bid = min_bid;
        a.rake_bps = rake_bps;
        a.buyout = buyout;
        a.ends_at = ends_at;
        a.high_bidder = Pubkey::default();
        a.high_bid = 0;
        a.status = AuctionStatus::Open;
        a.bump = ctx.bumps.auction;

        emit!(AuctionOpened {
            auction_id,
            seller,
            settler,
            mint: a.mint,
            min_bid,
            rake_bps,
            buyout,
            ends_at,
        });
        Ok(())
    }

    /// The core primitive: place a bid, atomically refunding the prior high bidder.
    ///
    /// In one instruction: pull `amount` from the bidder into the vault
    /// (bidder-signed), then, if a prior high bidder exists, refund them their
    /// EXACT prior bid via a program-signed CPI to an account they own. After the
    /// swap the vault holds exactly the new `amount`. Everything is checked; the
    /// prior refund can never go to the wrong account.
    pub fn place_bid(ctx: Context<PlaceBid>, auction_id: u64, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bidder_key = ctx.accounts.bidder.key();

        let (prior_high_bid, prior_high_bidder, bump, mint_key) = {
            let a = &ctx.accounts.auction;
            require!(a.status == AuctionStatus::Open, AuctionError::NotOpen);
            require!(now < a.ends_at, AuctionError::AuctionEnded);
            require!(bidder_key != a.seller, AuctionError::SelfBid);
            require!(bidder_key != a.high_bidder, AuctionError::AlreadyHighBidder);

            let min_acceptable = compute_min_acceptable(a.min_bid, a.high_bid)
                .ok_or(AuctionError::Overflow)?;
            require!(amount >= min_acceptable, AuctionError::BidTooLow);

            (a.high_bid, a.high_bidder, a.bump, a.mint)
        };

        // 1) Pull the new bid into the vault (bidder-signed).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bidder_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.bidder.to_account_info(),
                },
            ),
            amount,
        )?;

        // 2) Refund the prior high bidder their exact prior bid (program-signed),
        //    but only when one exists and only to an account they own.
        if prior_high_bid > 0 {
            let prior_token = ctx
                .accounts
                .prior_bidder_token
                .as_ref()
                .ok_or(AuctionError::WrongPriorBidder)?;
            require!(
                prior_token.owner == prior_high_bidder,
                AuctionError::WrongPriorBidder
            );
            require!(prior_token.mint == mint_key, AuctionError::WrongMint);

            let id = auction_id.to_le_bytes();
            let seeds: &[&[u8]] = &[b"auction", id.as_ref(), &[bump]];
            let signer: &[&[&[u8]]] = &[seeds];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: prior_token.to_account_info(),
                        authority: ctx.accounts.auction.to_account_info(),
                    },
                    signer,
                ),
                prior_high_bid,
            )?;
        }

        // 3) Record the new high bid.
        let a = &mut ctx.accounts.auction;
        a.high_bidder = bidder_key;
        a.high_bid = amount;

        emit!(BidPlaced {
            auction_id,
            bidder: bidder_key,
            amount,
            refunded_prior: prior_high_bid,
        });
        Ok(())
    }

    /// Settler-only settle. Allowed at ends_at, or immediately once a bid meets
    /// the buyout (buyout is enforced here, not auto-settled in place_bid). With
    /// bids: burn the capped rake and pay the seller the rest, then close the
    /// vault. With no bids: close the vault to the seller (opener), Cancelled.
    pub fn settle_auction(ctx: Context<SettleAuction>, auction_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (high_bid, high_bidder, rake, payout, bump) = {
            let a = &ctx.accounts.auction;
            require!(a.status == AuctionStatus::Open, AuctionError::NotOpen);
            let ended = now >= a.ends_at;
            let bought_out = a.buyout != 0 && a.high_bid >= a.buyout;
            require!(ended || bought_out, AuctionError::NotEnded);

            let total = ctx.accounts.vault.amount;
            let rake = compute_rake(a.high_bid, a.rake_bps).ok_or(AuctionError::Overflow)?;
            let payout = total.checked_sub(rake).ok_or(AuctionError::Overflow)?;
            (a.high_bid, a.high_bidder, rake, payout, a.bump)
        };

        let id = auction_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"auction", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        settle_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.seller_token,
            ctx.accounts.seller.to_account_info(),
            ctx.accounts.auction.to_account_info(),
            signer,
            rake,
            payout,
        )?;

        let a = &mut ctx.accounts.auction;
        a.status = if high_bid == 0 {
            AuctionStatus::Cancelled
        } else {
            AuctionStatus::Settled
        };
        emit!(AuctionSettled {
            auction_id,
            winner: if high_bid == 0 {
                Pubkey::default()
            } else {
                high_bidder
            },
            payout,
            burned: rake,
        });
        Ok(())
    }

    /// Settler-only cancel before settle: refund the standing high bidder (if
    /// any) their deposit from the vault, then close it. The refund can only go
    /// to an account owned by the recorded high bidder, so a griefed or errored
    /// auction is unwound with the bidder always made whole.
    pub fn cancel_auction(ctx: Context<CancelAuction>, auction_id: u64) -> Result<()> {
        let (high_bid, high_bidder, bump, mint_key) = {
            let a = &ctx.accounts.auction;
            require!(a.status == AuctionStatus::Open, AuctionError::NotOpen);
            (a.high_bid, a.high_bidder, a.bump, a.mint)
        };

        let id = auction_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"auction", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        let total = ctx.accounts.vault.amount;
        if total > 0 {
            // A standing deposit belongs to the high bidder. Drain the FULL vault
            // to them (their bid plus any stray donation) so a griefing transfer
            // into the open vault ATA cannot wedge the close.
            require!(high_bid > 0, AuctionError::WrongPriorBidder);
            let refund_token = ctx
                .accounts
                .high_bidder_token
                .as_ref()
                .ok_or(AuctionError::WrongPriorBidder)?;
            require!(
                refund_token.owner == high_bidder,
                AuctionError::WrongPriorBidder
            );
            require!(refund_token.mint == mint_key, AuctionError::WrongMint);

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: refund_token.to_account_info(),
                        authority: ctx.accounts.auction.to_account_info(),
                    },
                    signer,
                ),
                total,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.auction.to_account_info(),
            },
            signer,
        ))?;

        let a = &mut ctx.accounts.auction;
        a.status = AuctionStatus::Cancelled;
        emit!(AuctionCancelled {
            auction_id,
            refunded: total,
        });
        Ok(())
    }

    /// Permissionless liveness valve. Once the settler has had its window
    /// (ends_at + grace) and still has not settled, ANYONE can drive the
    /// deterministic outcome: the winner and payout are fixed by on-chain state,
    /// so a permissionless settle is safe and a down settler can never strand
    /// funds. Same economics as settle_auction.
    pub fn reclaim_expired(ctx: Context<ReclaimExpired>, auction_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (high_bid, high_bidder, rake, payout, bump) = {
            let a = &ctx.accounts.auction;
            require!(a.status == AuctionStatus::Open, AuctionError::NotOpen);
            let deadline = a
                .ends_at
                .checked_add(RECLAIM_GRACE_SECS)
                .ok_or(AuctionError::Overflow)?;
            require!(now >= deadline, AuctionError::NotEnded);

            let total = ctx.accounts.vault.amount;
            let rake = compute_rake(a.high_bid, a.rake_bps).ok_or(AuctionError::Overflow)?;
            let payout = total.checked_sub(rake).ok_or(AuctionError::Overflow)?;
            (a.high_bid, a.high_bidder, rake, payout, a.bump)
        };

        let id = auction_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"auction", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        settle_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.seller_token,
            ctx.accounts.seller.to_account_info(),
            ctx.accounts.auction.to_account_info(),
            signer,
            rake,
            payout,
        )?;

        let a = &mut ctx.accounts.auction;
        a.status = if high_bid == 0 {
            AuctionStatus::Cancelled
        } else {
            AuctionStatus::Settled
        };
        emit!(AuctionReclaimed {
            auction_id,
            winner: if high_bid == 0 {
                Pubkey::default()
            } else {
                high_bidder
            },
            payout,
            burned: rake,
        });
        Ok(())
    }
}

/// Shared settle economics for both the settler path and the permissionless
/// reclaim path: burn the rake from the vault, pay the remainder to the seller,
/// then close the (now empty) vault to the seller. All transfers are
/// program-signed with the auction PDA seeds.
#[allow(clippy::too_many_arguments)]
fn settle_vault<'info>(
    token_program: &Program<'info, Token>,
    mint: &Account<'info, Mint>,
    vault: &Account<'info, TokenAccount>,
    seller_token: &Account<'info, TokenAccount>,
    seller: AccountInfo<'info>,
    auction: AccountInfo<'info>,
    signer: &[&[&[u8]]],
    rake: u64,
    payout: u64,
) -> Result<()> {
    if rake > 0 {
        token::burn(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                Burn {
                    mint: mint.to_account_info(),
                    from: vault.to_account_info(),
                    authority: auction.clone(),
                },
                signer,
            ),
            rake,
        )?;
    }
    if payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                Transfer {
                    from: vault.to_account_info(),
                    to: seller_token.to_account_info(),
                    authority: auction.clone(),
                },
                signer,
            ),
            payout,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: seller,
            authority: auction,
        },
        signer,
    ))?;
    Ok(())
}

// ----- accounts -----

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct OpenAuction<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,

    #[account(
        init,
        payer = opener,
        space = 8 + Auction::INIT_SPACE,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub auction: Account<'info, Auction>,

    // Reject Token-2022: the anchor_spl Mint type only deserializes a mint owned
    // by the legacy SPL Token program, and the explicit owner constraint on the
    // vault below documents that guard with a clear Token2022NotSupported error.
    pub mint: Account<'info, Mint>,

    // Program-owned vault: an ATA whose authority is the auction PDA, so only a
    // program-signed CPI can move bids out. The constraint ties the mint's owner
    // to the legacy SPL Token program (== token_program.key()), rejecting a
    // Token-2022 mint with an explicit error.
    #[account(
        init,
        payer = opener,
        associated_token::mint = mint,
        associated_token::authority = auction,
        constraint = *mint.to_account_info().owner == token_program.key() @ AuctionError::Token2022NotSupported
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        associated_token::mint = auction.mint,
        associated_token::authority = auction
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = bidder_token.mint == auction.mint @ AuctionError::WrongMint,
        constraint = bidder_token.owner == bidder.key() @ AuctionError::Unauthorized
    )]
    pub bidder_token: Account<'info, TokenAccount>,

    // Optional: required only when a prior high bid exists. It must be owned by
    // the recorded high_bidder, enforced in the instruction body (a constraint
    // cannot reach into an Option here).
    #[account(mut)]
    pub prior_bidder_token: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct SettleAuction<'info> {
    // The realm key recorded on the auction. has_one binds it to the stored
    // settler, so no other signer can settle.
    pub settler: Signer<'info>,

    /// CHECK: rent destination for the vault close; pinned to the seller (opener)
    /// recorded on the auction.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = settler @ AuctionError::Unauthorized,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,

    #[account(mut, address = auction.mint @ AuctionError::WrongMint)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = auction.mint,
        associated_token::authority = auction
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token.mint == auction.mint @ AuctionError::WrongMint,
        constraint = seller_token.owner == auction.seller @ AuctionError::Unauthorized
    )]
    pub seller_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CancelAuction<'info> {
    pub settler: Signer<'info>,

    /// CHECK: rent destination for the vault close; pinned to the seller (opener)
    /// recorded on the auction.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = settler @ AuctionError::Unauthorized,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        associated_token::mint = auction.mint,
        associated_token::authority = auction
    )]
    pub vault: Account<'info, TokenAccount>,

    // Optional: required only when a standing high bid exists. Must be owned by
    // the recorded high_bidder, enforced in the instruction body.
    #[account(mut)]
    pub high_bidder_token: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct ReclaimExpired<'info> {
    // Permissionless: any signer (the fee payer) may call. No has_one settler.
    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: rent destination for the vault close; pinned to the seller (opener)
    /// recorded on the auction.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,

    #[account(mut, address = auction.mint @ AuctionError::WrongMint)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = auction.mint,
        associated_token::authority = auction
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token.mint == auction.mint @ AuctionError::WrongMint,
        constraint = seller_token.owner == auction.seller @ AuctionError::Unauthorized
    )]
    pub seller_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ----- state -----

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub auction_id: u64,
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub settler: Pubkey,
    pub min_bid: u64,
    pub rake_bps: u16,
    pub buyout: u64,
    pub ends_at: i64,
    pub high_bidder: Pubkey,
    pub high_bid: u64,
    pub status: AuctionStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionStatus {
    Open,
    Settled,
    Cancelled,
}

// ----- events -----

#[event]
pub struct AuctionOpened {
    pub auction_id: u64,
    pub seller: Pubkey,
    pub settler: Pubkey,
    pub mint: Pubkey,
    pub min_bid: u64,
    pub rake_bps: u16,
    pub buyout: u64,
    pub ends_at: i64,
}

#[event]
pub struct BidPlaced {
    pub auction_id: u64,
    pub bidder: Pubkey,
    pub amount: u64,
    pub refunded_prior: u64,
}

#[event]
pub struct AuctionSettled {
    pub auction_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub burned: u64,
}

#[event]
pub struct AuctionCancelled {
    pub auction_id: u64,
    pub refunded: u64,
}

#[event]
pub struct AuctionReclaimed {
    pub auction_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub burned: u64,
}

// ----- errors -----

#[error_code]
pub enum AuctionError {
    #[msg("amount must be greater than zero")]
    AmountZero,
    #[msg("rake exceeds the maximum allowed")]
    RakeTooHigh,
    #[msg("buyout must be zero or at least the minimum bid")]
    BadBuyout,
    #[msg("auction end time is out of the allowed range")]
    BadDuration,
    #[msg("token account mint does not match the auction mint")]
    WrongMint,
    #[msg("signer is not authorized for this action")]
    Unauthorized,
    #[msg("auction is not in the Open state")]
    NotOpen,
    #[msg("the auction has already ended")]
    AuctionEnded,
    #[msg("a seller cannot bid on their own auction")]
    SelfBid,
    #[msg("already the standing high bidder")]
    AlreadyHighBidder,
    #[msg("bid does not meet the minimum acceptable amount")]
    BidTooLow,
    #[msg("prior bidder token account does not match the recorded high bidder")]
    WrongPriorBidder,
    #[msg("the auction has not ended, or the reclaim grace period has not elapsed")]
    NotEnded,
    #[msg("Token-2022 mints are not supported; use the legacy SPL Token program")]
    Token2022NotSupported,
    #[msg("checked math overflow")]
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_bid_must_meet_min_bid() {
        // No standing bid: the minimum acceptable is exactly min_bid.
        assert_eq!(compute_min_acceptable(100, 0), Some(100));
        assert_eq!(compute_min_acceptable(1, 0), Some(1));
    }

    #[test]
    fn later_bid_must_beat_high_bid_by_five_percent() {
        // 5% of 100_000_000 is 5_000_000, so the next bid floor is 105_000_000.
        assert_eq!(
            compute_min_acceptable(100, 100_000_000),
            Some(105_000_000)
        );
        // 5% of 1_000 is 50, floor 1_050.
        assert_eq!(compute_min_acceptable(100, 1_000), Some(1_050));
    }

    #[test]
    fn min_raise_floors_at_one_unit() {
        // 5% of 10 rounds down to 0, so max(1, 0) forces at least a 1-unit raise.
        assert_eq!(compute_min_acceptable(1, 10), Some(11));
        // 5% of 19 rounds down to 0 as well (19*500/10000 = 0), floor +1.
        assert_eq!(compute_min_acceptable(1, 19), Some(20));
    }

    #[test]
    fn min_acceptable_rejects_overflow() {
        // high_bid at the ceiling plus a positive raise cannot fit in u64.
        assert_eq!(compute_min_acceptable(1, u64::MAX), None);
    }

    #[test]
    fn rake_is_capped_percentage() {
        // 5% rake on 300_000_000 is 15_000_000.
        assert_eq!(compute_rake(300_000_000, 500), Some(15_000_000));
        // 10% (the cap) on 1_000_000_000 is 100_000_000.
        assert_eq!(compute_rake(1_000_000_000, MAX_RAKE_BPS), Some(100_000_000));
    }

    #[test]
    fn rake_zero_when_no_bid_or_zero_bps() {
        assert_eq!(compute_rake(0, 500), Some(0));
        assert_eq!(compute_rake(1_000_000, 0), Some(0));
    }

    #[test]
    fn rake_never_exceeds_high_bid() {
        // At the u64 ceiling the capped rake still fits and stays below the bid.
        let r = compute_rake(u64::MAX, MAX_RAKE_BPS).unwrap();
        assert!(r < u64::MAX);
        assert_eq!(r, ((u64::MAX as u128) * 1_000 / 10_000) as u64);
    }
}
