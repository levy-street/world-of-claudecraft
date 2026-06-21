use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

declare_id!("6Dg85JcaHyJqzewtaYzJCjNgX1s64QPqSuATYD2Tukjj");

// Slots the unstake timelock holds the principal after a decommission request.
// On devnet (about 2.5 slots/sec) 60 slots is roughly 24s, short enough to
// exercise the full lock to decommission to release flow inside a test run. A
// mainnet build raises this to about 72h worth of slots (roughly 622000) so a
// realm's players get a real migration window. It is a program constant, never
// an instruction argument, so a departing owner can never shorten it to zero:
// the timelock protects the realm's players, not the owner.
const UNLOCK_TIMELOCK_SLOTS: u64 = 60;

#[program]
pub mod realm_stake_escrow {
    use super::*;

    // Stake (lock) `amount` of the realm token into a program owned vault keyed
    // by realm_id. The funds can only ever leave via `release`, signed by this
    // same owner after the timelock. Non-custodial: there is no server key that
    // can move them, and the only exit returns exactly the principal.
    pub fn lock(ctx: Context<Lock>, realm_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::AmountZero);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.staker_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
        )?;

        let stake = &mut ctx.accounts.stake;
        stake.owner = ctx.accounts.staker.key();
        stake.realm_id = realm_id;
        stake.mint = ctx.accounts.mint.key();
        stake.amount = amount;
        stake.locked_at_slot = Clock::get()?.slot;
        stake.unlock_eligible_slot = 0;
        stake.status = StakeStatus::Locked;
        stake.bump = ctx.bumps.stake;

        emit!(Locked {
            realm_id,
            owner: stake.owner,
            mint: stake.mint,
            amount,
        });
        Ok(())
    }

    // Owner begins decommissioning, starting the unstake timelock. Owner only,
    // and only while the stake is Locked.
    pub fn request_decommission(ctx: Context<OwnerOnly>) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        require!(stake.status == StakeStatus::Locked, EscrowError::NotLocked);
        stake.status = StakeStatus::Decommissioning;
        stake.unlock_eligible_slot = Clock::get()?.slot.saturating_add(UNLOCK_TIMELOCK_SLOTS);

        emit!(DecommissionRequested {
            realm_id: stake.realm_id,
            owner: stake.owner,
            unlock_eligible_slot: stake.unlock_eligible_slot,
        });
        Ok(())
    }

    // Owner releases the full principal back to their own token account once the
    // timelock has elapsed, then the vault and stake accounts close (rent back to
    // the owner). Returns exactly the locked principal: there is no yield path,
    // so the refund is always less than or equal to the original sink.
    pub fn release(ctx: Context<Release>, realm_id: u64) -> Result<()> {
        require!(
            ctx.accounts.stake.status == StakeStatus::Decommissioning,
            EscrowError::NotDecommissioning
        );
        require!(
            Clock::get()?.slot >= ctx.accounts.stake.unlock_eligible_slot,
            EscrowError::TimelockNotElapsed
        );

        let amount = ctx.accounts.vault.amount;
        let realm_id_bytes = realm_id.to_le_bytes();
        let bump = ctx.accounts.stake.bump;
        let seeds: &[&[u8]] = &[b"realm", realm_id_bytes.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.owner_token.to_account_info(),
                        authority: ctx.accounts.stake.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }

        // Close the now empty vault, rent back to the owner.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.stake.to_account_info(),
            },
            signer,
        ))?;

        ctx.accounts.stake.status = StakeStatus::Released;

        emit!(Released {
            realm_id,
            owner: ctx.accounts.stake.owner,
            amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(realm_id: u64)]
pub struct Lock<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        init,
        payer = staker,
        space = 8 + RealmStake::INIT_SPACE,
        seeds = [b"realm", realm_id.to_le_bytes().as_ref()],
        bump
    )]
    pub stake: Account<'info, RealmStake>,

    pub mint: Account<'info, Mint>,

    // The program owned vault: an ATA whose authority is the stake PDA, so only
    // a program signed CPI can move the staked tokens out.
    #[account(
        init,
        payer = staker,
        associated_token::mint = mint,
        associated_token::authority = stake
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = staker_token.mint == mint.key() @ EscrowError::WrongMint,
        constraint = staker_token.owner == staker.key() @ EscrowError::Unauthorized
    )]
    pub staker_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ EscrowError::Unauthorized)]
    pub stake: Account<'info, RealmStake>,
}

#[derive(Accounts)]
#[instruction(realm_id: u64)]
pub struct Release<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        has_one = owner @ EscrowError::Unauthorized,
        seeds = [b"realm", realm_id.to_le_bytes().as_ref()],
        bump = stake.bump
    )]
    pub stake: Account<'info, RealmStake>,

    #[account(
        mut,
        associated_token::mint = stake.mint,
        associated_token::authority = stake
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token.mint == stake.mint @ EscrowError::WrongMint,
        constraint = owner_token.owner == owner.key() @ EscrowError::Unauthorized
    )]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct RealmStake {
    pub owner: Pubkey,
    pub realm_id: u64,
    pub mint: Pubkey,
    pub amount: u64,
    pub locked_at_slot: u64,
    pub unlock_eligible_slot: u64,
    pub status: StakeStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum StakeStatus {
    Locked,
    Decommissioning,
    Released,
}

#[event]
pub struct Locked {
    pub realm_id: u64,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DecommissionRequested {
    pub realm_id: u64,
    pub owner: Pubkey,
    pub unlock_eligible_slot: u64,
}

#[event]
pub struct Released {
    pub realm_id: u64,
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("stake amount must be greater than zero")]
    AmountZero,
    #[msg("token account mint does not match the realm mint")]
    WrongMint,
    #[msg("signer is not the stake owner")]
    Unauthorized,
    #[msg("stake is not in the Locked state")]
    NotLocked,
    #[msg("stake is not in the Decommissioning state")]
    NotDecommissioning,
    #[msg("the unstake timelock has not elapsed")]
    TimelockNotElapsed,
}
