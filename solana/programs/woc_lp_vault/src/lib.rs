//! Non-custodial $WOC LP staking vault (the liquidity side of the GameFi flywheel).
//!
//! Players stake DEX LP tokens (an SPL mint, e.g. the WOC/SOL pool LP) into a
//! per-staker program-owned vault with an optional time lock. The lock buys a
//! veLP reward multiplier OFF-chain: the server snapshots positions each epoch
//! and accrues $WOC rewards against the #799 flow ledger (emissions bounded by
//! verified inflows). This program owns exactly one job: custody the LP tokens
//! so that
//!   - principal can only ever return to the staker who deposited it,
//!   - a time lock, once taken, cannot be shortened (locked_until is monotone),
//!   - no server key can move anyone's LP (per-position PDA vaults; the only
//!     authority is the position PDA itself).
//!
//! Reward payment is NOT here by design: rewards flow through the existing
//! woc_escrow distribution vault + flow ledger, so there is no parallel
//! emission system to audit. Pausing a pool stops NEW deposits and lock
//! extensions only; unstake of an expired lock always works (principal exit is
//! never gated, even paused).
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

declare_id!("9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6");

/// Hard cap on a lock (366 days). A program constant, never an instruction
/// argument, so no caller can create an effectively-permanent lock by mistake
/// or malice (fat-finger protection for stakers).
pub const MAX_LOCK_SECONDS: u32 = 366 * 24 * 60 * 60;

#[program]
pub mod woc_lp_vault {
    use super::*;

    /// The realm authority registers a staking pool for one LP mint. The pool
    /// account carries config + aggregates only; LP tokens live in per-position
    /// vaults, so the pool itself never holds funds.
    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.authority = ctx.accounts.authority.key();
        pool.total_staked = 0;
        pool.paused = false;
        pool.bump = ctx.bumps.pool;
        emit!(PoolInitialized { pool: pool.key(), lp_mint: pool.lp_mint, authority: pool.authority });
        Ok(())
    }

    /// Create the staker's (empty) position + its program-owned vault. Split
    /// from `stake` so stake stays re-runnable without init_if_needed; the
    /// client sends [open_position, stake] in one transaction on first stake.
    pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        position.pool = ctx.accounts.pool.key();
        position.owner = ctx.accounts.owner.key();
        position.amount = 0;
        position.locked_until = 0;
        position.staked_at = 0;
        position.bump = ctx.bumps.position;
        Ok(())
    }

    /// Stake `amount` LP tokens with a `lock_seconds` time lock. Adding to an
    /// existing position can only ever EXTEND the lock: the new expiry is
    /// max(current expiry, now + lock_seconds), so later deposits inherit the
    /// longest outstanding lock and no deposit shortens one.
    pub fn stake(ctx: Context<Stake>, amount: u64, lock_seconds: u32) -> Result<()> {
        require!(amount > 0, LpVaultError::AmountZero);
        require!(lock_seconds <= MAX_LOCK_SECONDS, LpVaultError::LockTooLong);
        require!(!ctx.accounts.pool.paused, LpVaultError::PoolPaused);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let requested = now
            .checked_add(lock_seconds as i64)
            .ok_or(LpVaultError::Overflow)?;
        let position = &mut ctx.accounts.position;
        position.amount = position.amount.checked_add(amount).ok_or(LpVaultError::Overflow)?;
        position.locked_until = position.locked_until.max(requested);
        if position.staked_at == 0 {
            position.staked_at = now;
        }
        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool.total_staked.checked_add(amount).ok_or(LpVaultError::Overflow)?;

        emit!(Staked {
            pool: pool.key(),
            owner: position.owner,
            amount,
            position_amount: position.amount,
            locked_until: position.locked_until,
        });
        Ok(())
    }

    /// Extend the lock without depositing (a tier upgrade). Monotone like
    /// stake: the expiry can only move later, never earlier.
    pub fn extend_lock(ctx: Context<ExtendLock>, lock_seconds: u32) -> Result<()> {
        require!(lock_seconds <= MAX_LOCK_SECONDS, LpVaultError::LockTooLong);
        require!(!ctx.accounts.pool.paused, LpVaultError::PoolPaused);
        let position = &mut ctx.accounts.position;
        require!(position.amount > 0, LpVaultError::NothingStaked);
        let now = Clock::get()?.unix_timestamp;
        let requested = now
            .checked_add(lock_seconds as i64)
            .ok_or(LpVaultError::Overflow)?;
        require!(requested > position.locked_until, LpVaultError::LockNotExtended);
        position.locked_until = requested;
        emit!(LockExtended { pool: ctx.accounts.pool.key(), owner: position.owner, locked_until: requested });
        Ok(())
    }

    /// Withdraw `amount` LP tokens once the lock has expired. Works even when
    /// the pool is paused: pausing gates deposits, never a principal exit. The
    /// off-chain reward side treats an unstake as the anti-mercenary trigger
    /// (unvested accruals forfeit proportionally); the principal itself is
    /// always whole.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, LpVaultError::AmountZero);
        let now = Clock::get()?.unix_timestamp;
        let (owner, pool_key, bump) = {
            let position = &ctx.accounts.position;
            require!(now >= position.locked_until, LpVaultError::StillLocked);
            require!(amount <= position.amount, LpVaultError::InsufficientStake);
            (position.owner, position.pool, position.bump)
        };

        let seeds: &[&[u8]] = &[b"position", pool_key.as_ref(), owner.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        position.amount = position.amount.checked_sub(amount).ok_or(LpVaultError::Overflow)?;
        if position.amount == 0 {
            position.staked_at = 0;
        }
        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool.total_staked.checked_sub(amount).ok_or(LpVaultError::Overflow)?;

        emit!(Unstaked { pool: pool.key(), owner, amount, position_amount: position.amount });
        Ok(())
    }

    /// Close an emptied position, reclaiming both the vault's and the position
    /// account's rent. Owner only; refuses while any stake remains.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &ctx.accounts.position;
        require!(position.amount == 0, LpVaultError::PositionNotEmpty);
        require!(ctx.accounts.vault.amount == 0, LpVaultError::PositionNotEmpty);
        let seeds: &[&[u8]] = &[b"position", position.pool.as_ref(), position.owner.as_ref(), &[position.bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer,
        ))?;
        emit!(PositionClosed { pool: position.pool, owner: position.owner });
        Ok(())
    }

    /// Pause or resume NEW deposits and lock extensions (authority only). The
    /// emergency brake for the fail-closed rail: unstake keeps working.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.pool.paused = paused;
        emit!(PoolPausedSet { pool: ctx.accounts.pool.key(), paused });
        Ok(())
    }
}

// ----- accounts -----

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", lp_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    pub lp_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(address = pool.lp_mint @ LpVaultError::WrongMint)]
    pub lp_mint: Account<'info, Mint>,

    // Program-owned vault: an ATA whose authority is the position PDA, so only
    // a program-signed CPI (unstake or close) can ever move the LP out.
    #[account(
        init,
        payer = owner,
        associated_token::mint = lp_mint,
        associated_token::authority = position
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        has_one = owner @ LpVaultError::Unauthorized,
        constraint = position.pool == pool.key() @ LpVaultError::WrongPool,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = pool.lp_mint,
        associated_token::authority = position
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token.mint == pool.lp_mint @ LpVaultError::WrongMint,
        constraint = owner_token.owner == owner.key() @ LpVaultError::Unauthorized
    )]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExtendLock<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        has_one = owner @ LpVaultError::Unauthorized,
        constraint = position.pool == pool.key() @ LpVaultError::WrongPool,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        has_one = owner @ LpVaultError::Unauthorized,
        constraint = position.pool == pool.key() @ LpVaultError::WrongPool,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = pool.lp_mint,
        associated_token::authority = position
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token.mint == pool.lp_mint @ LpVaultError::WrongMint,
        constraint = owner_token.owner == owner.key() @ LpVaultError::Unauthorized
    )]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        close = owner,
        has_one = owner @ LpVaultError::Unauthorized,
        constraint = position.pool == pool.key() @ LpVaultError::WrongPool,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = pool.lp_mint,
        associated_token::authority = position
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ LpVaultError::Unauthorized,
        seeds = [b"pool", pool.lp_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

// ----- state -----

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub lp_mint: Pubkey,
    pub authority: Pubkey,
    pub total_staked: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    /// Unix time before which unstake refuses. Monotone non-decreasing while
    /// the position is open; 0 = never locked.
    pub locked_until: i64,
    /// Unix time of the first stake into the (currently open) position; reset
    /// to 0 when fully unstaked. Off-chain vesting reads this.
    pub staked_at: i64,
    pub bump: u8,
}

// ----- events -----

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub lp_mint: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct Staked {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub position_amount: u64,
    pub locked_until: i64,
}

#[event]
pub struct LockExtended {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub locked_until: i64,
}

#[event]
pub struct Unstaked {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub position_amount: u64,
}

#[event]
pub struct PositionClosed {
    pub pool: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct PoolPausedSet {
    pub pool: Pubkey,
    pub paused: bool,
}

// ----- errors -----

#[error_code]
pub enum LpVaultError {
    #[msg("amount must be greater than zero")]
    AmountZero,
    #[msg("lock exceeds the maximum allowed duration")]
    LockTooLong,
    #[msg("the position's time lock has not expired")]
    StillLocked,
    #[msg("unstake exceeds the staked amount")]
    InsufficientStake,
    #[msg("the pool is paused to new deposits")]
    PoolPaused,
    #[msg("position still holds staked tokens")]
    PositionNotEmpty,
    #[msg("token account mint does not match the pool's LP mint")]
    WrongMint,
    #[msg("position does not belong to this pool")]
    WrongPool,
    #[msg("signer is not authorized for this action")]
    Unauthorized,
    #[msg("requested lock does not extend the current one")]
    LockNotExtended,
    #[msg("nothing staked in this position")]
    NothingStaked,
    #[msg("arithmetic overflow")]
    Overflow,
}
