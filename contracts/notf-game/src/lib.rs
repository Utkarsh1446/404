//! Regular-round settlement.
//!
//! The operator commits `sha256(notfound-v1|location|lat|lng|salt)` before the
//! player guesses. The player then submits a guess (free, or paid by burning
//! NOTF). Anyone who knows the preimage can reveal it. The contract recomputes
//! the distance and mints the reward. A server signature is not accepted as a
//! payout: the operator cannot change the place or the prize after seeing the pin.

use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, PanicOnDefault,
};
use notfound_math::{commitment_payload, distance_meters, reward_whole_notf, whole_to_yocto};

const STARTER_WHOLE: u128 = 100;
const ENTRY_WHOLE: u128 = 10;
const FREE_PER_DAY: u32 = 3;
const GUESS_WINDOW_MS: u64 = 5 * 60 * 1000;
const REVEAL_WINDOW_MS: u64 = 15 * 60 * 1000;

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Game {
    owner: AccountId,
    operator: AccountId,
    token: AccountId,
    rounds: LookupMap<String, Round>,
    daily_uses: LookupMap<String, u32>,
    starters: LookupSet<AccountId>,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub operator: AccountId,
    pub token: AccountId,
    pub starter: String,
    pub entry_fee: String,
    pub free_per_day: u32,
    pub threshold_m: u64,
    pub guess_window_ms: u64,
}

#[near(serializers = [borsh, json])]
pub struct Round {
    pub player: AccountId,
    pub location_id: String,
    pub commitment: String,
    pub status: String,
    pub guess_lat_e6: Option<i32>,
    pub guess_lng_e6: Option<i32>,
    pub actual_lat_e6: Option<i32>,
    pub actual_lng_e6: Option<i32>,
    pub distance_m: Option<u64>,
    pub reward: u128,
    pub fee: u128,
    pub committed_at_ms: u64,
    pub guess_deadline_ms: u64,
    pub guessed_at_ms: Option<u64>,
    pub reveal_deadline_ms: Option<u64>,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Rounds,
    DailyUses,
    Starters,
}

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait ExtToken {
    fn mint(&mut self, account_id: AccountId, amount: U128);
    fn operator_burn(&mut self, account_id: AccountId, amount: U128);
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_fee_burned(&mut self, round_id: String);
}

#[near]
impl Game {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId, token_id: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        Self {
            owner: owner_id,
            operator: operator_id,
            token: token_id,
            rounds: LookupMap::new(StorageKey::Rounds),
            daily_uses: LookupMap::new(StorageKey::DailyUses),
            starters: LookupSet::new(StorageKey::Starters),
        }
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            token: self.token.clone(),
            starter: whole_to_yocto(STARTER_WHOLE).to_string(),
            entry_fee: whole_to_yocto(ENTRY_WHOLE).to_string(),
            free_per_day: FREE_PER_DAY,
            threshold_m: 50_000,
            guess_window_ms: GUESS_WINDOW_MS,
        }
    }

    pub fn get_round(&self, round_id: String) -> Option<Round> {
        self.rounds.get(&round_id)
    }

    pub fn free_remaining(&self, player: AccountId) -> u32 {
        let used = self.daily_uses.get(&day_key(&player)).unwrap_or(0);
        FREE_PER_DAY.saturating_sub(used)
    }

    pub fn starter_claimed(&self, player: AccountId) -> bool {
        self.starters.contains(&player)
    }

    /// One-time 100 NOTF faucet. The relayer calls this so a new guest session
    /// has a balance before the player spends anything.
    pub fn claim_starter(&mut self, player: AccountId) {
        let predecessor = env::predecessor_account_id();
        require!(
            predecessor == self.operator || predecessor == player,
            "not allowed"
        );
        require!(!self.starters.contains(&player), "already claimed");
        self.starters.insert(&player);
        ext_token::ext(self.token.clone())
            .with_static_gas(Gas::from_tgas(40))
            .mint(player, U128(whole_to_yocto(STARTER_WHOLE)))
            .detach();
    }

    /// Lock the place before the guess exists.
    pub fn commit_round(
        &mut self,
        round_id: String,
        player: AccountId,
        location_id: String,
        commitment: String,
    ) {
        self.assert_operator();
        require!(round_id.len() <= 48 && !round_id.is_empty(), "bad round id");
        require!(location_id.len() <= 48 && !location_id.is_empty(), "bad location");
        require!(commitment.len() == 64, "commitment must be 64 hex chars");
        require!(self.rounds.get(&round_id).is_none(), "round exists");
        let now = env::block_timestamp_ms();
        self.rounds.insert(
            &round_id,
            &Round {
                player,
                location_id,
                commitment,
                status: "open".to_string(),
                guess_lat_e6: None,
                guess_lng_e6: None,
                actual_lat_e6: None,
                actual_lng_e6: None,
                distance_m: None,
                reward: 0,
                fee: 0,
                committed_at_ms: now,
                guess_deadline_ms: now + GUESS_WINDOW_MS,
                guessed_at_ms: None,
                reveal_deadline_ms: None,
            },
        );
    }

    pub fn submit_guess(&mut self, round_id: String, lat_e6: i32, lng_e6: i32) {
        let player = env::predecessor_account_id();
        let mut round = self.rounds.get(&round_id).expect("round missing");
        require!(round.player == player, "not your round");
        require!(round.status == "open", "round not open");
        require!(env::block_timestamp_ms() <= round.guess_deadline_ms, "guess window closed");
        require!(valid_coord(lat_e6, lng_e6), "bad coordinates");
        round.guess_lat_e6 = Some(lat_e6);
        round.guess_lng_e6 = Some(lng_e6);
        round.guessed_at_ms = Some(env::block_timestamp_ms());
        round.reveal_deadline_ms = Some(env::block_timestamp_ms() + REVEAL_WINDOW_MS);

        if self.free_remaining(player.clone()) > 0 {
            let key = day_key(&player);
            let used = self.daily_uses.get(&key).unwrap_or(0);
            self.daily_uses.insert(&key, &(used + 1));
            round.status = "guessed".to_string();
            self.rounds.insert(&round_id, &round);
        } else {
            round.status = "fee_pending".to_string();
            round.fee = whole_to_yocto(ENTRY_WHOLE);
            self.rounds.insert(&round_id, &round);
            ext_token::ext(self.token.clone())
                .with_static_gas(Gas::from_tgas(30))
                .operator_burn(player, U128(round.fee))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(20))
                        .on_fee_burned(round_id),
                )
                .detach();
        }
    }

    #[private]
    pub fn on_fee_burned(&mut self, round_id: String) {
        let mut round = self.rounds.get(&round_id).expect("round missing");
        if round.status != "fee_pending" {
            return;
        }
        if env::promise_result_checked(0, 1024).is_ok() {
            round.status = "guessed".to_string();
        } else {
            round.status = "open".to_string();
            round.guess_lat_e6 = None;
            round.guess_lng_e6 = None;
            round.guessed_at_ms = None;
            round.reveal_deadline_ms = None;
            round.fee = 0;
        }
        self.rounds.insert(&round_id, &round);
    }

    /// Open the committed place and pay from the distance the contract measures.
    pub fn reveal_and_settle(
        &mut self,
        round_id: String,
        lat_e6: i32,
        lng_e6: i32,
        salt_hex: String,
    ) {
        let mut round = self.rounds.get(&round_id).expect("round missing");
        require!(round.status == "guessed", "round not guessed");
        let deadline = round.reveal_deadline_ms.expect("missing reveal deadline");
        require!(env::block_timestamp_ms() <= deadline, "reveal window closed");
        require!(valid_coord(lat_e6, lng_e6), "bad coordinates");
        require!(salt_hex.len() == 64, "bad salt");
        let payload = commitment_payload(&round.location_id, lat_e6, lng_e6, &salt_hex);
        let digest = env::sha256(payload.as_bytes());
        require!(hex_encode(&digest) == round.commitment, "commitment mismatch");

        let guess_lat = round.guess_lat_e6.expect("missing guess");
        let guess_lng = round.guess_lng_e6.expect("missing guess");
        let distance = distance_meters(lat_e6, lng_e6, guess_lat, guess_lng);
        let reward = whole_to_yocto(reward_whole_notf(distance));
        round.status = "settled".to_string();
        round.actual_lat_e6 = Some(lat_e6);
        round.actual_lng_e6 = Some(lng_e6);
        round.distance_m = Some(distance);
        round.reward = reward;
        let player = round.player.clone();
        self.rounds.insert(&round_id, &round);

        if reward > 0 {
            ext_token::ext(self.token.clone())
                .with_static_gas(Gas::from_tgas(40))
                .mint(player, U128(reward))
                .detach();
        }
    }

    pub fn expire_round(&mut self, round_id: String) {
        let mut round = self.rounds.get(&round_id).expect("round missing");
        let now = env::block_timestamp_ms();
        if round.status == "open" {
            require!(now > round.guess_deadline_ms, "guess window still open");
            round.status = "expired".to_string();
            self.rounds.insert(&round_id, &round);
            return;
        }
        if round.status == "guessed" {
            let deadline = round.reveal_deadline_ms.expect("missing reveal deadline");
            require!(now > deadline, "reveal window still open");
            let fee = round.fee;
            let player = round.player.clone();
            round.status = "expired".to_string();
            self.rounds.insert(&round_id, &round);
            if fee > 0 {
                ext_token::ext(self.token.clone())
                    .with_static_gas(Gas::from_tgas(40))
                    .mint(player, U128(fee))
                    .detach();
            }
            return;
        }
        env::panic_str("round cannot expire");
    }
}

impl Game {
    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "operator only");
    }
}

fn day_key(player: &AccountId) -> String {
    let day = env::block_timestamp_ms() / 86_400_000;
    format!("{player}:{day}")
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

    fn context(predecessor: near_sdk::AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .block_timestamp(1_700_000_000_000_000_000);
        builder
    }

    fn init() -> Game {
        testing_env!(context(accounts(1)).build());
        Game::new(accounts(1), accounts(1), accounts(2))
    }

    fn commit(game: &mut Game, round_id: &str, commitment: &str) {
        testing_env!(context(accounts(1)).build());
        game.commit_round(
            round_id.to_string(),
            accounts(3),
            "loc-test".to_string(),
            commitment.to_string(),
        );
    }

    #[test]
    fn reveal_pays_from_distance_not_from_a_signature() {
        let mut game = init();
        let salt = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let actual_lat = 48_856_600;
        let actual_lng = 2_352_200;
        let hash = commitment_hash("loc-test", actual_lat, actual_lng, salt);
        commit(&mut game, "round-1", &hex_encode(&hash));

        testing_env!(context(accounts(3)).build());
        // A pin about 1.1 km away: the 15 NOTF tier, not a number the operator picks.
        game.submit_guess("round-1".to_string(), 48_860_600, 2_337_600);

        testing_env!(context(accounts(1)).build());
        game.reveal_and_settle("round-1".to_string(), actual_lat, actual_lng, salt.to_string());
        let round = game.get_round("round-1".to_string()).unwrap();
        assert_eq!(round.status, "settled");
        assert_eq!(round.distance_m, Some(1_156));
        assert_eq!(round.reward, whole_to_yocto(15));
    }

    #[test]
    #[should_panic(expected = "commitment mismatch")]
    fn reveal_rejects_a_swapped_location() {
        let mut game = init();
        let salt = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let hash = commitment_hash("loc-test", 48_856_600, 2_352_200, salt);
        commit(&mut game, "round-2", &hex_encode(&hash));
        testing_env!(context(accounts(3)).build());
        game.submit_guess("round-2".to_string(), 0, 0);
        testing_env!(context(accounts(1)).build());
        game.reveal_and_settle("round-2".to_string(), 10_000_000, 10_000_000, salt.to_string());
    }

    #[test]
    fn fourth_guess_requires_a_fee() {
        let mut game = init();
        let salt = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        for index in 0..4 {
            let hash = commitment_hash("loc-test", 1_000, 2_000, salt);
            let round_id = format!("r{index}");
            commit(&mut game, &round_id, &hex_encode(&hash));
            testing_env!(context(accounts(3)).build());
            game.submit_guess(round_id.clone(), 1_000, 2_000);
            let status = game.get_round(round_id).unwrap().status;
            if index < 3 {
                assert_eq!(status, "guessed");
            } else {
                assert_eq!(status, "fee_pending");
            }
        }
        assert_eq!(game.free_remaining(accounts(3)), 0);
    }

    #[test]
    #[should_panic(expected = "not your round")]
    fn other_player_cannot_guess() {
        let mut game = init();
        let salt = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let hash = commitment_hash("loc-test", 1, 2, salt);
        commit(&mut game, "owned", &hex_encode(&hash));
        testing_env!(context(accounts(4)).build());
        game.submit_guess("owned".to_string(), 1, 2);
    }
}
