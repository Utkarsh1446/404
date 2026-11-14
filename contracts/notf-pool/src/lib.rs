//! Drop prize pool.
//!
//! NOTF is escrowed with `ft_transfer_call`. Opening a drop locks a prize against
//! a location commitment. Players submit one guess each. After the window, the
//! preimage is revealed and the closest guess inside 50 km is paid from escrow.
//! If nobody is close enough, the prize unlocks back into the pool.

use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, PanicOnDefault, PromiseOrValue,
};
use notfound_math::{commitment_payload, distance_meters, REWARD_THRESHOLD_M};

const MAX_GUESSES: usize = 64;

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Pool {
    owner: AccountId,
    operator: AccountId,
    token: AccountId,
    available: u128,
    drops: LookupMap<String, Drop>,
}

#[near(serializers = [borsh, json])]
pub struct DropGuess {
    pub player: AccountId,
    pub lat_e6: i32,
    pub lng_e6: i32,
    pub at_ms: u64,
}

#[near(serializers = [borsh, json])]
pub struct Drop {
    pub commitment: String,
    pub location_id: String,
    pub prize: u128,
    pub status: String,
    pub closes_at_ms: u64,
    pub guesses: Vec<DropGuess>,
    pub winner: Option<AccountId>,
    pub winning_distance_m: Option<u64>,
    pub actual_lat_e6: Option<i32>,
    pub actual_lng_e6: Option<i32>,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Drops,
}

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait ExtToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Pool {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId, token_id: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        Self {
            owner: owner_id,
            operator: operator_id,
            token: token_id,
            available: 0,
            drops: LookupMap::new(StorageKey::Drops),
        }
    }

    pub fn get_available(&self) -> U128 {
        U128(self.available)
    }

    pub fn get_drop(&self, drop_id: String) -> Option<Drop> {
        self.drops.get(&drop_id)
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "not the NOTF token");
        let _ = (sender_id, msg);
        self.available = self.available.saturating_add(amount.0);
        PromiseOrValue::Value(U128(0))
    }

    pub fn open_drop(
        &mut self,
        drop_id: String,
        location_id: String,
        commitment: String,
        prize: U128,
        closes_at_ms: u64,
    ) {
        self.assert_operator();
        require!(drop_id.len() <= 48 && !drop_id.is_empty(), "bad drop id");
        require!(commitment.len() == 64, "commitment must be 64 hex chars");
        require!(self.drops.get(&drop_id).is_none(), "drop exists");
        require!(prize.0 > 0, "prize required");
        require!(self.available >= prize.0, "pool is short");
        require!(closes_at_ms > env::block_timestamp_ms(), "close is in the past");
        self.available -= prize.0;
        self.drops.insert(
            &drop_id,
            &Drop {
                commitment,
                location_id,
                prize: prize.0,
                status: "open".to_string(),
                closes_at_ms,
                guesses: Vec::new(),
                winner: None,
                winning_distance_m: None,
                actual_lat_e6: None,
                actual_lng_e6: None,
            },
        );
    }

    pub fn submit_guess(&mut self, drop_id: String, lat_e6: i32, lng_e6: i32) {
        let player = env::predecessor_account_id();
        let mut drop = self.drops.get(&drop_id).expect("drop missing");
        require!(drop.status == "open", "drop not open");
        require!(env::block_timestamp_ms() < drop.closes_at_ms, "drop closed");
        require!(valid_coord(lat_e6, lng_e6), "bad coordinates");
        require!(drop.guesses.len() < MAX_GUESSES, "drop is full");
        require!(
            !drop.guesses.iter().any(|guess| guess.player == player),
            "already guessed"
        );
        drop.guesses.push(DropGuess {
            player,
            lat_e6,
            lng_e6,
            at_ms: env::block_timestamp_ms(),
        });
        self.drops.insert(&drop_id, &drop);
    }

    pub fn settle(&mut self, drop_id: String, lat_e6: i32, lng_e6: i32, salt_hex: String) {
        let mut drop = self.drops.get(&drop_id).expect("drop missing");
        require!(drop.status == "open", "drop not open");
        require!(env::block_timestamp_ms() >= drop.closes_at_ms, "drop still open");
        require!(valid_coord(lat_e6, lng_e6), "bad coordinates");
        require!(salt_hex.len() == 64, "bad salt");
        let payload = commitment_payload(&drop.location_id, lat_e6, lng_e6, &salt_hex);
        let digest = env::sha256(payload.as_bytes());
        require!(hex_encode(&digest) == drop.commitment, "commitment mismatch");

        let mut best: Option<(usize, u64)> = None;
        for (index, guess) in drop.guesses.iter().enumerate() {
            let distance = distance_meters(lat_e6, lng_e6, guess.lat_e6, guess.lng_e6);
            if distance > REWARD_THRESHOLD_M {
                continue;
            }
            let replace = match best {
                None => true,
                Some((best_index, best_distance)) => {
                    distance < best_distance
                        || (distance == best_distance && guess.at_ms < drop.guesses[best_index].at_ms)
                }
            };
            if replace {
                best = Some((index, distance));
            }
        }

        drop.actual_lat_e6 = Some(lat_e6);
        drop.actual_lng_e6 = Some(lng_e6);
        drop.status = "settled".to_string();
        if let Some((index, distance)) = best {
            let winner = drop.guesses[index].player.clone();
            drop.winner = Some(winner.clone());
            drop.winning_distance_m = Some(distance);
            let prize = drop.prize;
            self.drops.insert(&drop_id, &drop);
            ext_token::ext(self.token.clone())
                .with_attached_deposit(near_sdk::NearToken::from_yoctonear(1))
                .with_static_gas(Gas::from_tgas(40))
                .ft_transfer(winner, U128(prize), Some("drop prize".to_string()))
                .detach();
        } else {
            self.available += drop.prize;
            drop.prize = 0;
            self.drops.insert(&drop_id, &drop);
        }
    }
}

impl Pool {
    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "operator only");
    }
}

fn valid_coord(lat_e6: i32, lng_e6: i32) -> bool {
    (-90_000_000..=90_000_000).contains(&lat_e6) && (-180_000_000..=180_000_000).contains(&lng_e6)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;
    use notfound_math::commitment_hash;

    fn context(predecessor: AccountId, now_ms: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .block_timestamp(now_ms * 1_000_000);
        builder
    }

    #[test]
    fn drop_pays_the_closer_guess_from_escrow() {
        let now = 1_700_000_000_000;
        testing_env!(context(accounts(1), now).build());
        let mut pool = Pool::new(accounts(1), accounts(1), accounts(2));
        testing_env!(context(accounts(2), now).build());
        let _ = pool.ft_on_transfer(accounts(1), U128(50), String::new());
        assert_eq!(pool.get_available().0, 50);

        let salt = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let hash = commitment_hash("loc-drop", 48_856_600, 2_352_200, salt);
        testing_env!(context(accounts(1), now).build());
        pool.open_drop(
            "drop-1".to_string(),
            "loc-drop".to_string(),
            hex_encode(&hash),
            U128(25),
            now + 1_000,
        );
        assert_eq!(pool.get_available().0, 25);

        testing_env!(context(accounts(3), now + 10).build());
        pool.submit_guess("drop-1".to_string(), 48_860_600, 2_337_600);
        testing_env!(context(accounts(4), now + 20).build());
        pool.submit_guess("drop-1".to_string(), 51_507_400, -127_800);

        testing_env!(context(accounts(1), now + 1_000).build());
        pool.settle("drop-1".to_string(), 48_856_600, 2_352_200, salt.to_string());
        let drop = pool.get_drop("drop-1".to_string()).unwrap();
        assert_eq!(drop.status, "settled");
        assert_eq!(drop.winner, Some(accounts(3)));
        assert_eq!(drop.winning_distance_m, Some(1_156));
        assert_eq!(pool.get_available().0, 25);
    }

    #[test]
    fn nobody_close_returns_the_prize() {
        let now = 1_700_000_000_000;
        testing_env!(context(accounts(1), now).build());
        let mut pool = Pool::new(accounts(1), accounts(1), accounts(2));
        testing_env!(context(accounts(2), now).build());
        let _ = pool.ft_on_transfer(accounts(1), U128(10), String::new());
        let salt = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        let hash = commitment_hash("loc-drop", 0, 0, salt);
        testing_env!(context(accounts(1), now).build());
        pool.open_drop(
            "drop-2".to_string(),
            "loc-drop".to_string(),
            hex_encode(&hash),
            U128(10),
            now + 50,
        );
        testing_env!(context(accounts(3), now + 10).build());
        pool.submit_guess("drop-2".to_string(), 40_000_000, 0);
        testing_env!(context(accounts(1), now + 50).build());
        pool.settle("drop-2".to_string(), 0, 0, salt.to_string());
        let drop = pool.get_drop("drop-2".to_string()).unwrap();
        assert!(drop.winner.is_none());
        assert_eq!(pool.get_available().0, 10);
    }
}
