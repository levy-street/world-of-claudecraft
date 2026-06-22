//! Non-custodial $WOC GameFi escrow.
//!
//! Two program-owned-vault flows back the GameFi flywheel, both keyed by an id
//! so a vault is a PDA only a program-signed CPI can move funds out of (no
//! server hot key can ever divert player money):
//!
//!  - Winner-takes-all 1v1 match pot (#478). Two players stake the same amount
//!    into a head-to-head vault; on settle the pot pays out to the winner minus
//!    a burn rake (rake tokens are burned, not skimmed to a treasury), so every
//!    match is net-deflationary. This is the demand engine: you must hold $WOC to
//!    queue, and a P2P transfer mints nothing.
//!  - Seasonal reward distribution (#480). The realm authority opens a per-season
//!    vault, the treasury / recirculated rake funds it, and rewards are paid out
//!    rank by rank to the top ladder. A pure fund-then-emit pool: a payout can
//!    never exceed the funded balance, the on-chain mirror of the off-chain flow
//!    ledger invariant (emissions <= verified sinks).
//!
//! The money movement is the part that must be a program: stakes can only leave
//! via settle (to a player) or cancel (refund before an opponent joins), and a
//! season vault can only pay out what was funded in.
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

declare_id!("Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ");

pub const BPS_DENOMINATOR: u128 = 10_000;
/// Hard cap on the per-pot burn rake (10%). A program constant, never an
/// instruction argument, so no caller can set a confiscatory rake.
pub const MAX_RAKE_BPS: u16 = 1_000;

#[program]
pub mod woc_escrow {
    use super::*;

    // ----- #478 winner-takes-all 1v1 match escrow -----

    /// Player A opens a match: locks `stake` into a program-owned vault keyed by
    /// `match_id`, and fixes the burn rake (capped) and the settler (the realm
    /// server key allowed to report the winner).
    pub fn open_match(ctx: Context<OpenMatch>, match_id: u64, stake: u64, rake_bps: u16, settler: Pubkey) -> Result<()> {
        require!(stake > 0, EscrowError::AmountZero);
        require!(rake_bps <= MAX_RAKE_BPS, EscrowError::RakeTooHigh);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            stake,
        )?;

        let m = &mut ctx.accounts.match_account;
        m.match_id = match_id;
        m.mint = ctx.accounts.mint.key();
        m.creator = ctx.accounts.creator.key();
        m.opponent = Pubkey::default();
        m.settler = settler;
        m.stake = stake;
        m.rake_bps = rake_bps;
        m.status = MatchStatus::Open;
        m.bump = ctx.bumps.match_account;

        emit!(MatchOpened { match_id, creator: m.creator, mint: m.mint, stake, rake_bps });
        Ok(())
    }

    /// Player B joins by matching the exact stake. The pot is now 2 * stake and
    /// locked: the only exit is settle.
    pub fn join_match(ctx: Context<JoinMatch>, _match_id: u64) -> Result<()> {
        let stake = {
            let m = &ctx.accounts.match_account;
            require!(m.status == MatchStatus::Open, EscrowError::NotOpen);
            require!(m.creator != ctx.accounts.opponent.key(), EscrowError::SelfPlay);
            m.stake
        };

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.opponent_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.opponent.to_account_info(),
                },
            ),
            stake,
        )?;

        let m = &mut ctx.accounts.match_account;
        m.opponent = ctx.accounts.opponent.key();
        m.status = MatchStatus::Locked;

        emit!(MatchJoined { match_id: m.match_id, opponent: m.opponent, pot: stake.saturating_mul(2) });
        Ok(())
    }

    /// The settler reports the winner. The pot pays out to the winner minus a
    /// burn rake: the rake is burned from the vault (net-deflationary), the rest
    /// transferred to the winner, then the vault closes (rent back to the
    /// creator). The winner must be one of the two players.
    pub fn settle_match(ctx: Context<SettleMatch>, match_id: u64) -> Result<()> {
        let (rake, payout, bump) = {
            let m = &ctx.accounts.match_account;
            require!(m.status == MatchStatus::Locked, EscrowError::NotLocked);
            let winner = ctx.accounts.winner_token.owner;
            require!(winner == m.creator || winner == m.opponent, EscrowError::NotAPlayer);
            let pot = ctx.accounts.vault.amount;
            let rake = ((pot as u128).saturating_mul(m.rake_bps as u128) / BPS_DENOMINATOR) as u64;
            (rake, pot.saturating_sub(rake), m.bump)
        };

        let id = match_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"match", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if rake > 0 {
            token::burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.match_account.to_account_info(),
                    },
                    signer,
                ),
                rake,
            )?;
        }
        if payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.winner_token.to_account_info(),
                        authority: ctx.accounts.match_account.to_account_info(),
                    },
                    signer,
                ),
                payout,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: ctx.accounts.match_account.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.match_account.status = MatchStatus::Settled;
        emit!(MatchSettled { match_id, winner: ctx.accounts.winner_token.owner, payout, burned: rake });
        Ok(())
    }

    /// Refund both stakes on a drawn bout: each player gets their original stake
    /// back (no rake, since neither won), then the vault closes. Settler only,
    /// Locked only. This is the only Locked exit other than settle, so a drawn
    /// pot can never be stranded.
    pub fn refund_match(ctx: Context<RefundMatch>, match_id: u64) -> Result<()> {
        let (stake, bump) = {
            let m = &ctx.accounts.match_account;
            require!(m.status == MatchStatus::Locked, EscrowError::NotLocked);
            (m.stake, m.bump)
        };

        let id = match_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"match", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator_token.to_account_info(),
                    authority: ctx.accounts.match_account.to_account_info(),
                },
                signer,
            ),
            stake,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.opponent_token.to_account_info(),
                    authority: ctx.accounts.match_account.to_account_info(),
                },
                signer,
            ),
            stake,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: ctx.accounts.match_account.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.match_account.status = MatchStatus::Refunded;
        emit!(MatchRefunded { match_id, each: stake });
        Ok(())
    }

    /// Refund the creator if no opponent ever joined. Creator only, Open only.
    pub fn cancel_match(ctx: Context<CancelMatch>, match_id: u64) -> Result<()> {
        require!(ctx.accounts.match_account.status == MatchStatus::Open, EscrowError::NotOpen);

        let amount = ctx.accounts.vault.amount;
        let bump = ctx.accounts.match_account.bump;
        let id = match_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"match", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.creator_token.to_account_info(),
                        authority: ctx.accounts.match_account.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: ctx.accounts.match_account.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.match_account.status = MatchStatus::Cancelled;
        emit!(MatchCancelled { match_id, refunded: amount });
        Ok(())
    }

    // ----- #480 seasonal reward distribution escrow -----

    /// The realm authority opens a per-season distribution vault.
    pub fn open_distribution(ctx: Context<OpenDistribution>, season_id: u64) -> Result<()> {
        let d = &mut ctx.accounts.distribution;
        d.season_id = season_id;
        d.mint = ctx.accounts.mint.key();
        d.authority = ctx.accounts.authority.key();
        d.total_funded = 0;
        d.total_paid = 0;
        d.status = DistributionStatus::Open;
        d.bump = ctx.bumps.distribution;
        emit!(DistributionOpened { season_id, authority: d.authority, mint: d.mint });
        Ok(())
    }

    /// Fund the season pool. Anyone may add to it (treasury, recirculated rake);
    /// the funded total is the ceiling on everything that can ever be paid out.
    pub fn fund_distribution(ctx: Context<FundDistribution>, _season_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::AmountZero);
        require!(ctx.accounts.distribution.status == DistributionStatus::Open, EscrowError::NotOpen);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
        )?;

        let d = &mut ctx.accounts.distribution;
        d.total_funded = d.total_funded.saturating_add(amount);
        emit!(DistributionFunded { season_id: d.season_id, amount, total_funded: d.total_funded });
        Ok(())
    }

    /// Pay `amount` from the season vault to one recipient. Authority only, and
    /// only up to the vault balance, so emissions can never exceed what was
    /// funded in. Called once per rank at season close.
    pub fn payout(ctx: Context<Payout>, season_id: u64, amount: u64) -> Result<()> {
        let bump = {
            let d = &ctx.accounts.distribution;
            require!(d.status == DistributionStatus::Open, EscrowError::NotOpen);
            require!(amount > 0, EscrowError::AmountZero);
            require!(amount <= ctx.accounts.vault.amount, EscrowError::InsufficientPool);
            d.bump
        };

        let id = season_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"distribution", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.distribution.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        let d = &mut ctx.accounts.distribution;
        d.total_paid = d.total_paid.saturating_add(amount);
        emit!(RewardPaid { season_id, recipient: ctx.accounts.recipient_token.owner, amount });
        Ok(())
    }

    /// Close the season vault once paid out, returning any dust + the rent to the
    /// authority.
    pub fn close_distribution(ctx: Context<CloseDistribution>, season_id: u64) -> Result<()> {
        let bump = ctx.accounts.distribution.bump;
        let id = season_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"distribution", id.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        let dust = ctx.accounts.vault.amount;
        if dust > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.authority_token.to_account_info(),
                        authority: ctx.accounts.distribution.to_account_info(),
                    },
                    signer,
                ),
                dust,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.distribution.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.distribution.status = DistributionStatus::Closed;
        emit!(DistributionClosed { season_id, total_paid: ctx.accounts.distribution.total_paid });
        Ok(())
    }
}

// ----- match accounts -----

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct OpenMatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Match::INIT_SPACE,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub match_account: Account<'info, Match>,

    pub mint: Account<'info, Mint>,

    // Program-owned pot: an ATA whose authority is the match PDA, so only a
    // program-signed CPI (settle or cancel) can move the stakes out.
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = match_account
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token.mint == mint.key() @ EscrowError::WrongMint,
        constraint = creator_token.owner == creator.key() @ EscrowError::Unauthorized
    )]
    pub creator_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,

    #[account(
        mut,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, Match>,

    #[account(
        mut,
        associated_token::mint = match_account.mint,
        associated_token::authority = match_account
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = opponent_token.mint == match_account.mint @ EscrowError::WrongMint,
        constraint = opponent_token.owner == opponent.key() @ EscrowError::Unauthorized
    )]
    pub opponent_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct SettleMatch<'info> {
    // The realm server key recorded on the match. has_one binds it to the stored
    // settler, so no other signer can report a winner.
    pub settler: Signer<'info>,

    /// CHECK: rent destination only, pinned to the creator recorded on the match.
    #[account(mut, address = match_account.creator)]
    pub creator: UncheckedAccount<'info>,

    #[account(
        mut,
        close = creator,
        has_one = settler @ EscrowError::Unauthorized,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, Match>,

    #[account(mut, address = match_account.mint @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = match_account.mint,
        associated_token::authority = match_account
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = winner_token.mint == match_account.mint @ EscrowError::WrongMint)]
    pub winner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct CancelMatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        close = creator,
        has_one = creator @ EscrowError::Unauthorized,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, Match>,

    #[account(
        mut,
        associated_token::mint = match_account.mint,
        associated_token::authority = match_account
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token.mint == match_account.mint @ EscrowError::WrongMint,
        constraint = creator_token.owner == creator.key() @ EscrowError::Unauthorized
    )]
    pub creator_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct RefundMatch<'info> {
    // The settler binds via has_one, as in settle: only the realm server key can
    // declare a draw and trigger the refund.
    pub settler: Signer<'info>,

    /// CHECK: rent destination only, pinned to the creator recorded on the match.
    #[account(mut, address = match_account.creator)]
    pub creator: UncheckedAccount<'info>,

    #[account(
        mut,
        close = creator,
        has_one = settler @ EscrowError::Unauthorized,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, Match>,

    #[account(
        mut,
        associated_token::mint = match_account.mint,
        associated_token::authority = match_account
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token.mint == match_account.mint @ EscrowError::WrongMint,
        constraint = creator_token.owner == match_account.creator @ EscrowError::Unauthorized
    )]
    pub creator_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = opponent_token.mint == match_account.mint @ EscrowError::WrongMint,
        constraint = opponent_token.owner == match_account.opponent @ EscrowError::Unauthorized
    )]
    pub opponent_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ----- distribution accounts -----

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct OpenDistribution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Distribution::INIT_SPACE,
        seeds = [b"distribution", season_id.to_le_bytes().as_ref()],
        bump
    )]
    pub distribution: Account<'info, Distribution>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = distribution
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct FundDistribution<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"distribution", season_id.to_le_bytes().as_ref()],
        bump = distribution.bump
    )]
    pub distribution: Account<'info, Distribution>,

    #[account(
        mut,
        associated_token::mint = distribution.mint,
        associated_token::authority = distribution
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = funder_token.mint == distribution.mint @ EscrowError::WrongMint,
        constraint = funder_token.owner == funder.key() @ EscrowError::Unauthorized
    )]
    pub funder_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct Payout<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ EscrowError::Unauthorized,
        seeds = [b"distribution", season_id.to_le_bytes().as_ref()],
        bump = distribution.bump
    )]
    pub distribution: Account<'info, Distribution>,

    #[account(
        mut,
        associated_token::mint = distribution.mint,
        associated_token::authority = distribution
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = recipient_token.mint == distribution.mint @ EscrowError::WrongMint)]
    pub recipient_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct CloseDistribution<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        has_one = authority @ EscrowError::Unauthorized,
        seeds = [b"distribution", season_id.to_le_bytes().as_ref()],
        bump = distribution.bump
    )]
    pub distribution: Account<'info, Distribution>,

    #[account(
        mut,
        associated_token::mint = distribution.mint,
        associated_token::authority = distribution
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_token.mint == distribution.mint @ EscrowError::WrongMint,
        constraint = authority_token.owner == authority.key() @ EscrowError::Unauthorized
    )]
    pub authority_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ----- state -----

#[account]
#[derive(InitSpace)]
pub struct Match {
    pub match_id: u64,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub settler: Pubkey,
    pub stake: u64,
    pub rake_bps: u16,
    pub status: MatchStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MatchStatus {
    Open,
    Locked,
    Settled,
    Cancelled,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Distribution {
    pub season_id: u64,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub total_funded: u64,
    pub total_paid: u64,
    pub status: DistributionStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DistributionStatus {
    Open,
    Closed,
}

// ----- events -----

#[event]
pub struct MatchOpened {
    pub match_id: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub stake: u64,
    pub rake_bps: u16,
}

#[event]
pub struct MatchJoined {
    pub match_id: u64,
    pub opponent: Pubkey,
    pub pot: u64,
}

#[event]
pub struct MatchSettled {
    pub match_id: u64,
    pub winner: Pubkey,
    pub payout: u64,
    pub burned: u64,
}

#[event]
pub struct MatchCancelled {
    pub match_id: u64,
    pub refunded: u64,
}

#[event]
pub struct MatchRefunded {
    pub match_id: u64,
    pub each: u64,
}

#[event]
pub struct DistributionOpened {
    pub season_id: u64,
    pub authority: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct DistributionFunded {
    pub season_id: u64,
    pub amount: u64,
    pub total_funded: u64,
}

#[event]
pub struct RewardPaid {
    pub season_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DistributionClosed {
    pub season_id: u64,
    pub total_paid: u64,
}

// ----- errors -----

#[error_code]
pub enum EscrowError {
    #[msg("amount must be greater than zero")]
    AmountZero,
    #[msg("rake exceeds the maximum allowed")]
    RakeTooHigh,
    #[msg("token account mint does not match the escrow mint")]
    WrongMint,
    #[msg("signer is not authorized for this action")]
    Unauthorized,
    #[msg("escrow is not in the Open state")]
    NotOpen,
    #[msg("match is not in the Locked state")]
    NotLocked,
    #[msg("a player cannot join their own match")]
    SelfPlay,
    #[msg("declared winner is not a player in this match")]
    NotAPlayer,
    #[msg("payout exceeds the funded pool balance")]
    InsufficientPool,
}
