//! Daily-spinner SOL prize vault.
//!
//! Trust-minimized custody + payout for the holder spinner's SOL-dust prizes
//! (docs/prd/woc/daily-engagement-gacha.md). The treasury funds a single
//! program-owned vault PDA; a settler key (the server keeper) may release
//! lamports from it ONLY to a declared winner, ONLY up to a configured
//! per-payout cap, and ONLY once per (utc_day, account) spin. The settler never
//! custodies funds, cannot pay itself, and cannot exceed the cap: the worst a
//! compromised settler can do is drain the vault in cap-sized increments to real
//! winners, which the daily budget plus the cap bound.
//!
//! Money randomness stays off-chain: the outcome is decided by the provably fair
//! commit-reveal in server/fairness.ts (the daily commit is published before any
//! spins, the seed revealed after), and this program is the auditable settlement
//! plus the on-chain replay guard. Each payout creates a receipt PDA seeded by
//! (day, account_id), so the same spin can never be paid twice.
use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("SP1Nvau1111111111111111111111111111111111111");

#[program]
pub mod woc_spin_vault {
    use super::*;

    /// Create the vault config PDA. The authority (treasury) may later refill,
    /// reconfigure, and withdraw; the settler is the only key that can release
    /// payouts; `max_payout` is the hard per-payout ceiling in lamports.
    pub fn initialize(ctx: Context<Initialize>, settler: Pubkey, max_payout: u64) -> Result<()> {
        require!(max_payout > 0, VaultError::ZeroCap);
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.settler = settler;
        cfg.max_payout = max_payout;
        cfg.paused = false;
        cfg.total_paid = 0;
        cfg.payout_count = 0;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Authority only: rotate the settler key, adjust the cap, or pause/unpause.
    pub fn configure(ctx: Context<Configure>, settler: Pubkey, max_payout: u64, paused: bool) -> Result<()> {
        require!(max_payout > 0, VaultError::ZeroCap);
        let cfg = &mut ctx.accounts.config;
        cfg.settler = settler;
        cfg.max_payout = max_payout;
        cfg.paused = paused;
        Ok(())
    }

    /// Add SOL to the prize pool. Anyone may fund (typically the treasury). A
    /// plain system transfer to the config PDA also works; this exists so funding
    /// is explicit and emits an event for the public ledger.
    pub fn fund(ctx: Context<Fund>, lamports: u64) -> Result<()> {
        require!(lamports > 0, VaultError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.config.to_account_info(),
                },
            ),
            lamports,
        )?;
        emit!(Funded { funder: ctx.accounts.funder.key(), lamports });
        Ok(())
    }

    /// Settler only: pay `amount` lamports to `winner` for the spin identified by
    /// (day, account_id). The receipt PDA seeded by that pair is created here, so
    /// a second attempt for the same spin fails on the already-initialized
    /// receipt. Guards: not paused, amount in (0, cap], and the vault retains its
    /// rent-exempt minimum so the config account is never closed out from under
    /// the program.
    pub fn payout(ctx: Context<Payout>, day: u64, account_id: u64, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, VaultError::Paused);
        require!(amount > 0, VaultError::ZeroAmount);
        require!(amount <= ctx.accounts.config.max_payout, VaultError::OverCap);

        let vault = ctx.accounts.config.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(vault.data_len());
        let available = vault.lamports().saturating_sub(rent_min);
        require!(amount <= available, VaultError::Insufficient);

        // The config PDA is program-owned, so the program moves its own lamports
        // directly. The winner stays a plain wallet that needs no token account.
        **vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += amount;

        let winner_key = ctx.accounts.winner.key();
        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.receipt;
        receipt.day = day;
        receipt.account_id = account_id;
        receipt.winner = winner_key;
        receipt.amount = amount;
        receipt.paid_at = now;
        receipt.bump = ctx.bumps.receipt;

        let cfg = &mut ctx.accounts.config;
        cfg.total_paid = cfg.total_paid.checked_add(amount).unwrap();
        cfg.payout_count = cfg.payout_count.checked_add(1).unwrap();

        emit!(PaidOut { day, account_id, winner: winner_key, amount });
        Ok(())
    }

    /// Authority only: reclaim lamports from the vault (e.g. to retire the
    /// faucet), keeping the rent-exempt minimum.
    pub fn withdraw(ctx: Context<Withdraw>, lamports: u64) -> Result<()> {
        require!(lamports > 0, VaultError::ZeroAmount);
        let vault = ctx.accounts.config.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(vault.data_len());
        let available = vault.lamports().saturating_sub(rent_min);
        require!(lamports <= available, VaultError::Insufficient);
        **vault.try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += lamports;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::SIZE,
        seeds = [b"spin_vault"],
        bump,
    )]
    pub config: Account<'info, VaultConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Configure<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"spin_vault"],
        bump = config.bump,
        has_one = authority @ VaultError::NotAuthority,
    )]
    pub config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut, seeds = [b"spin_vault"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: u64, account_id: u64)]
pub struct Payout<'info> {
    #[account(mut)]
    pub settler: Signer<'info>,
    #[account(
        mut,
        seeds = [b"spin_vault"],
        bump = config.bump,
        has_one = settler @ VaultError::NotSettler,
    )]
    pub config: Account<'info, VaultConfig>,
    #[account(
        init,
        payer = settler,
        space = 8 + SpinReceipt::SIZE,
        seeds = [b"payout", day.to_le_bytes().as_ref(), account_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub receipt: Account<'info, SpinReceipt>,
    /// CHECK: the winning player's wallet; lamports are credited here. The server
    /// pins this to the spin's linked wallet and the program only moves SOL to it.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"spin_vault"],
        bump = config.bump,
        has_one = authority @ VaultError::NotAuthority,
    )]
    pub config: Account<'info, VaultConfig>,
}

#[account]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub settler: Pubkey,
    pub max_payout: u64,
    pub total_paid: u64,
    pub payout_count: u64,
    pub paused: bool,
    pub bump: u8,
}

impl VaultConfig {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct SpinReceipt {
    pub day: u64,
    pub account_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
    pub paid_at: i64,
    pub bump: u8,
}

impl SpinReceipt {
    pub const SIZE: usize = 8 + 8 + 32 + 8 + 8 + 1;
}

#[event]
pub struct Funded {
    pub funder: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct PaidOut {
    pub day: u64,
    pub account_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("payout cap must be greater than zero")]
    ZeroCap,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("the vault is paused")]
    Paused,
    #[msg("amount exceeds the per-payout cap")]
    OverCap,
    #[msg("vault has insufficient funds above rent")]
    Insufficient,
    #[msg("only the configured settler may release payouts")]
    NotSettler,
    #[msg("only the configured authority may do this")]
    NotAuthority,
}
