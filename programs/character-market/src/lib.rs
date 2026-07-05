//! Character marketplace escrow + buyback-funding split.
//!
//! Trustless, long-lived listings for tradeable World of ClaudeCraft characters
//! (PR #736). A character's tradeable identity is its `‹label›.worldofclaudecraft.sol`
//! SNS subdomain; this program escrows the **USDC settlement** and enforces the
//! 70 % seller / 30 % buyback-vault split atomically. The subdomain custody
//! transfer (into the listing PDA on `list`, out to the buyer on `buy`, back to
//! the seller on `cancel`) rides as SNS Name-Service instructions composed into
//! the same transaction, so a sale moves the name and the money together or not
//! at all.
//!
//! Money flow is the part that must be a program: the buyer's USDC is split and
//! delivered to the seller and the buyback vault in one instruction the buyer
//! cannot tamper with, and a listing can only be settled once.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("BE55pNoRLSCch5NmLcU6tg6NZFLe6yFw4Jnr3HfZBMpp");

/// Seller share, in basis points. The remainder funds the buyback-and-burn vault.
pub const SELLER_BPS: u64 = 7_000;
pub const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod character_market {
    use super::*;

    /// Create a listing for a bound character at `price_usdc`, valid until
    /// `expires_at` (unix seconds). The seller authorizes it; the subdomain is
    /// handed to the listing PDA by an SNS transfer instruction in the same tx.
    pub fn list(ctx: Context<List>, price_usdc: u64, expires_at: i64) -> Result<()> {
        require!(price_usdc > 0, MarketError::ZeroPrice);
        require!(expires_at > Clock::get()?.unix_timestamp, MarketError::ExpiryInPast);

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.subdomain = ctx.accounts.subdomain.key();
        listing.price_usdc = price_usdc;
        listing.expires_at = expires_at;
        listing.usdc_mint = ctx.accounts.usdc_mint.key();
        listing.seller_usdc = ctx.accounts.seller_usdc.key();
        listing.buyback_vault_usdc = ctx.accounts.buyback_vault_usdc.key();
        listing.bump = ctx.bumps.listing;
        Ok(())
    }

    /// Cancel an unsold listing and reclaim the rent. Seller only. The subdomain
    /// is returned to the seller by an SNS transfer instruction in the same tx.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        require_keys_eq!(ctx.accounts.seller.key(), ctx.accounts.listing.seller, MarketError::NotSeller);
        Ok(())
    }

    /// Buy a listed character: the buyer pays `price_usdc`, split 70 % to the
    /// seller and 30 % to the buyback vault, atomically. The subdomain moves to
    /// the buyer via an SNS transfer instruction in the same tx; closing the
    /// listing makes the sale single-settlement.
    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(Clock::get()?.unix_timestamp <= listing.expires_at, MarketError::ListingExpired);
        require_keys_eq!(ctx.accounts.seller_usdc.key(), listing.seller_usdc, MarketError::WrongSellerAccount);
        require_keys_eq!(ctx.accounts.buyback_vault_usdc.key(), listing.buyback_vault_usdc, MarketError::WrongVaultAccount);

        let price = listing.price_usdc;
        let seller_amount = price.checked_mul(SELLER_BPS).unwrap().checked_div(BPS_DENOMINATOR).unwrap();
        let buyback_amount = price.checked_sub(seller_amount).unwrap();

        // 70 % → seller.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    to: ctx.accounts.seller_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            seller_amount,
        )?;
        // 30 % → buyback-and-burn vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    to: ctx.accounts.buyback_vault_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            buyback_amount,
        )?;

        emit!(Sold {
            listing: listing.key(),
            subdomain: listing.subdomain,
            seller: listing.seller,
            buyer: ctx.accounts.buyer.key(),
            price_usdc: price,
            seller_amount,
            buyback_amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct List<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: the SNS name-registry account for the character's subdomain. Its
    /// custody is moved into the listing PDA by an SNS instruction in this tx;
    /// here we only record its key.
    pub subdomain: UncheckedAccount<'info>,
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::SIZE,
        seeds = [b"listing", subdomain.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: USDC mint; validated by the seller/vault token accounts' mint.
    pub usdc_mint: UncheckedAccount<'info>,
    #[account(token::mint = usdc_mint, token::authority = seller)]
    pub seller_usdc: Account<'info, TokenAccount>,
    #[account(token::mint = usdc_mint)]
    pub buyback_vault_usdc: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        close = seller,
        seeds = [b"listing", listing.subdomain.as_ref()],
        bump = listing.bump,
        has_one = seller,
    )]
    pub listing: Account<'info, Listing>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: rent from the closed listing returns to the seller.
    #[account(mut, address = listing.seller)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        close = seller,
        seeds = [b"listing", listing.subdomain.as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
    #[account(mut, token::authority = buyer)]
    pub buyer_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyback_vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub subdomain: Pubkey,
    pub usdc_mint: Pubkey,
    pub seller_usdc: Pubkey,
    pub buyback_vault_usdc: Pubkey,
    pub price_usdc: u64,
    pub expires_at: i64,
    pub bump: u8,
}

impl Listing {
    pub const SIZE: usize = 32 * 5 + 8 + 8 + 1;
}

#[event]
pub struct Sold {
    pub listing: Pubkey,
    pub subdomain: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price_usdc: u64,
    pub seller_amount: u64,
    pub buyback_amount: u64,
}

#[error_code]
pub enum MarketError {
    #[msg("price must be greater than zero")]
    ZeroPrice,
    #[msg("expiry must be in the future")]
    ExpiryInPast,
    #[msg("only the seller may do this")]
    NotSeller,
    #[msg("listing has expired")]
    ListingExpired,
    #[msg("seller USDC account does not match the listing")]
    WrongSellerAccount,
    #[msg("buyback vault account does not match the listing")]
    WrongVaultAccount,
}
