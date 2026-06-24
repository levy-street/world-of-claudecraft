//! Player-to-player job-contract escrow ("paid bodyguard").
//!
//! A PAYER hires a HELPER for an agreed in-game goal and locks an SPL-token
//! reward here. The reward sits in a per-job vault (an associated token account
//! owned by the job PDA) until the authoritative game server — the SETTLER key
//! recorded at `open` — decides the outcome: `release` pays the helper, `refund`
//! returns the funds to the payer. Both settling instructions close the vault
//! and the job account, so a job settles exactly once.
//!
//! Trust model (matches the house arena-wager escrow): non-custodial. The payer
//! signs their own deposit; the server never holds player keys. The settler key
//! is the only key that can move the escrow, and it can move it ONLY to the
//! helper (release) or back to the payer (refund) — it can never divert funds
//! elsewhere. The split is no split: 100% of the locked amount goes one way.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("EhKKSxsKzPXK2Sc3QZcLBgQsQbtjuRYvG95SfK871trX");

#[program]
pub mod job_escrow {
    use super::*;

    /// Lock `amount` of `mint` for job `job_id`. The payer funds the vault from
    /// their own token account; the server's settler key (recorded here) is the
    /// only key that can later release or refund. `job_id` is assigned by the
    /// server from a monotonic sequence and seeds the job PDA.
    pub fn open(ctx: Context<Open>, job_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        let job = &mut ctx.accounts.job;
        job.job_id = job_id;
        job.payer = ctx.accounts.payer.key();
        job.helper = ctx.accounts.helper.key();
        job.mint = ctx.accounts.mint.key();
        job.amount = amount;
        job.settler = ctx.accounts.settler.key();
        job.vault = ctx.accounts.vault.key();
        job.bump = ctx.bumps.job;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(Opened {
            job: job.key(),
            job_id,
            payer: job.payer,
            helper: job.helper,
            mint: job.mint,
            amount,
        });
        Ok(())
    }

    /// Pay the helper: the settler signs, the full vault balance moves to the
    /// helper's token account, the vault closes, and the job account closes with
    /// its rent returned to the payer.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let amount = ctx.accounts.job.amount;
        let job_id = ctx.accounts.job.job_id;
        let bump = ctx.accounts.job.bump;
        let id_bytes = job_id.to_le_bytes();
        let signer: &[&[&[u8]]] = &[&[b"job", id_bytes.as_ref(), &[bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.helper_token.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.job.to_account_info(),
            },
            signer,
        ))?;

        emit!(Settled { job: ctx.accounts.job.key(), job_id, to_helper: true, amount });
        Ok(())
    }

    /// Refund the payer: the settler signs, the full vault balance returns to the
    /// payer's token account, the vault closes, and the job account closes with
    /// its rent returned to the payer.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let amount = ctx.accounts.job.amount;
        let job_id = ctx.accounts.job.job_id;
        let bump = ctx.accounts.job.bump;
        let id_bytes = job_id.to_le_bytes();
        let signer: &[&[&[u8]]] = &[&[b"job", id_bytes.as_ref(), &[bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.payer_token.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.job.to_account_info(),
            },
            signer,
        ))?;

        emit!(Settled { job: ctx.accounts.job.key(), job_id, to_helper: false, amount });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct Open<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only the helper's key is recorded; funds reach it via its token
    /// account on release. Validated as the token owner there.
    pub helper: UncheckedAccount<'info>,
    /// CHECK: the server's settler/oracle key, recorded as the sole authority
    /// that can later release or refund. Not a signer at open.
    pub settler: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = payer)]
    pub payer_token: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + Job::SIZE,
        seeds = [b"job", job_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub job: Account<'info, Job>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = job,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub settler: Signer<'info>,
    #[account(
        mut,
        close = payer,
        seeds = [b"job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        has_one = settler,
        has_one = payer,
        has_one = vault,
    )]
    pub job: Account<'info, Job>,
    /// CHECK: rent destination on close; constrained to job.payer by has_one.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    #[account(mut, token::mint = job.mint, token::authority = job.helper)]
    pub helper_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub settler: Signer<'info>,
    #[account(
        mut,
        close = payer,
        seeds = [b"job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        has_one = settler,
        has_one = payer,
        has_one = vault,
    )]
    pub job: Account<'info, Job>,
    /// CHECK: rent + refund destination; constrained to job.payer by has_one.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    #[account(mut, token::mint = job.mint, token::authority = job.payer)]
    pub payer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Job {
    pub job_id: u64,
    pub payer: Pubkey,
    pub helper: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub settler: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
}

impl Job {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 32 + 32 + 1;
}

#[event]
pub struct Opened {
    pub job: Pubkey,
    pub job_id: u64,
    pub payer: Pubkey,
    pub helper: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Settled {
    pub job: Pubkey,
    pub job_id: u64,
    pub to_helper: bool,
    pub amount: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("amount must be greater than zero")]
    ZeroAmount,
}
