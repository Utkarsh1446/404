//! NEP-141 NOTF token.
//!
//! Regular play mints rewards and burns entry fees through the game contract.
//! Drop prizes are ordinary fungible-token transfers into the prize-pool contract.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::{LazyOption, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner: AccountId,
    minters: LookupSet<AccountId>,
    operators: LookupSet<AccountId>,
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
    Minters,
    Operators,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, game_id: AccountId, pool_id: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "notfound".to_string(),
            symbol: "NOTF".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        };
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            owner: owner_id.clone(),
            minters: LookupSet::new(StorageKey::Minters),
            operators: LookupSet::new(StorageKey::Operators),
        };
        this.minters.insert(&owner_id);
        this.minters.insert(&game_id);
        this.operators.insert(&game_id);
        // Pool only receives tokens; registering it here lets the owner fund drops
        // without a separate storage deposit race during deploy.
        this.token.internal_register_account(&owner_id);
        this.token.internal_register_account(&pool_id);
        let supply: u128 = 1_000_000 * 1_000_000_000_000_000_000;
        this.token.internal_deposit(&owner_id, supply);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: U128(supply),
            memo: Some("initial NOTF supply"),
        }
        .emit();
        this
    }

    pub fn add_minter(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.minters.insert(&account_id);
    }

    pub fn add_operator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.operators.insert(&account_id);
    }

    /// Mint new NOTF. Used for the starter grant and for round rewards.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.assert_minter();
        require!(amount.0 > 0, "amount must be positive");
        if self.token.storage_balance_of(account_id.clone()).is_none() {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("mint"),
        }
        .emit();
    }

    /// Burn NOTF from a player. Only the game contract may call this, and only
    /// after that player signed a paid `submit_guess`.
    pub fn operator_burn(&mut self, account_id: AccountId, amount: U128) {
        self.assert_operator();
        require!(amount.0 > 0, "amount must be positive");
        self.token.internal_withdraw(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtBurn {
            owner_id: &account_id,
            amount,
            memo: Some("entry fee"),
        }
        .emit();
        log!("burned {} from {}", amount.0, account_id);
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn assert_minter(&self) {
        require!(
            self.minters.contains(&env::predecessor_account_id()),
            "not a minter"
        );
    }

    fn assert_operator(&self) {
        require!(
            self.operators.contains(&env::predecessor_account_id()),
            "not an operator"
        );
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn setup() -> Contract {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(context.build());
        Contract::new(accounts(1), accounts(2), accounts(3))
    }

    #[test]
    fn initial_supply_sits_with_owner() {
        let contract = setup();
        let supply = 1_000_000 * 1_000_000_000_000_000_000;
        assert_eq!(contract.ft_total_supply().0, supply);
        assert_eq!(contract.ft_balance_of(accounts(1)).0, supply);
        assert_eq!(contract.ft_metadata().symbol, "NOTF");
        assert_eq!(contract.ft_metadata().decimals, 18);
    }

    #[test]
    fn game_can_mint_and_burn() {
        let mut contract = setup();
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(2))
            .signer_account_id(accounts(2));
        testing_env!(context.build());
        contract.mint(accounts(4), U128(50));
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 50);
        contract.operator_burn(accounts(4), U128(20));
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 30);
    }

    #[test]
    #[should_panic(expected = "not a minter")]
    fn stranger_cannot_mint() {
        let mut contract = setup();
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(4))
            .signer_account_id(accounts(4));
        testing_env!(context.build());
        contract.mint(accounts(4), U128(1));
    }
}
