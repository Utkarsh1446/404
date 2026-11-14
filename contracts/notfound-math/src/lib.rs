//! Integer distance and reward rules shared by the game and drop contracts.
//!
//! The distance is an equirectangular approximation with a fixed-point cosine.
//! It stays within about 0.1% of haversine under a few hundred kilometres, which
//! is the range that matters for a 50 km prize threshold. JavaScript uses the
//! same truncation order so a demo round and a testnet round agree.

use sha2::{Digest, Sha256};

pub const EARTH_METERS_NUM: i128 = 1_111_949_266;
pub const EARTH_METERS_DEN: i128 = 10_000_000_000;
pub const REWARD_THRESHOLD_M: u64 = 50_000;
pub const COMMITMENT_PREFIX: &str = "notfound-v1";

pub fn commitment_payload(location_id: &str, lat_e6: i32, lng_e6: i32, salt_hex: &str) -> String {
    format!("{COMMITMENT_PREFIX}|{location_id}|{lat_e6}|{lng_e6}|{salt_hex}")
}

pub fn commitment_hash(location_id: &str, lat_e6: i32, lng_e6: i32, salt_hex: &str) -> [u8; 32] {
    let payload = commitment_payload(location_id, lat_e6, lng_e6, salt_hex);
    let digest = Sha256::digest(payload.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Cosine of a latitude in microdegrees. Result scale is 1e9.
pub fn cos_scaled(deg_e6: i32) -> i128 {
    let pi_e9: i128 = 3_141_592_654;
    let scale: i128 = 1_000_000_000;
    let mut x = (deg_e6 as i128) * pi_e9 / 180_000_000;
    if x < 0 {
        x = -x;
    }
    let x2 = x * x / scale;
    let mut term = scale;
    let mut sum = term;
    let dens = [2, 12, 30, 56, 90, 132];
    let mut sign: i128 = -1;
    for denominator in dens {
        term = term * x2 / scale / denominator;
        sum += sign * term;
        sign = -sign;
    }
    sum
}

fn isqrt(n: u128) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = x.div_ceil(2);
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x as u64
}

pub fn distance_meters(lat1_e6: i32, lng1_e6: i32, lat2_e6: i32, lng2_e6: i32) -> u64 {
    let mean = ((lat1_e6 as i64 + lat2_e6 as i64) / 2) as i32;
    let cos = cos_scaled(mean);
    let d_lat = (lat2_e6 as i128) - (lat1_e6 as i128);
    let d_lng = (lng2_e6 as i128) - (lng1_e6 as i128);
    let north = d_lat * EARTH_METERS_NUM / EARTH_METERS_DEN;
    let east_micro = d_lng * cos / 1_000_000_000;
    let east = east_micro * EARTH_METERS_NUM / EARTH_METERS_DEN;
    let north = north.unsigned_abs();
    let east = east.unsigned_abs();
    isqrt(north * north + east * east)
}

/// Whole NOTF awarded for a settled guess. The token contract applies 18 decimals.
pub fn reward_whole_notf(distance_m: u64) -> u128 {
    if distance_m <= 1_000 {
        25
    } else if distance_m <= 10_000 {
        15
    } else if distance_m <= 25_000 {
        8
    } else if distance_m <= REWARD_THRESHOLD_M {
        3
    } else {
        0
    }
}

pub fn whole_to_yocto(whole: u128) -> u128 {
    whole * 1_000_000_000_000_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_distance() {
        assert_eq!(distance_meters(48_856_600, 2_352_200, 48_856_600, 2_352_200), 0);
    }

    #[test]
    fn matches_shared_vectors() {
        assert_eq!(
            distance_meters(48_856_600, 2_352_200, 48_860_600, 2_337_600),
            1_156
        );
        assert_eq!(
            distance_meters(48_856_600, 2_352_200, 51_507_400, -127_800),
            343_602
        );
        assert_eq!(
            distance_meters(40_712_800, -74_006_000, 40_758_000, -73_985_500),
            5_314
        );
    }

    #[test]
    fn symmetric() {
        let a = distance_meters(35_676_200, 139_650_300, 35_011_600, 135_768_100);
        let b = distance_meters(35_011_600, 135_768_100, 35_676_200, 139_650_300);
        assert_eq!(a, b);
    }

    #[test]
    fn reward_tiers() {
        assert_eq!(reward_whole_notf(0), 25);
        assert_eq!(reward_whole_notf(1_000), 25);
        assert_eq!(reward_whole_notf(1_001), 15);
        assert_eq!(reward_whole_notf(10_000), 15);
        assert_eq!(reward_whole_notf(25_000), 8);
        assert_eq!(reward_whole_notf(50_000), 3);
        assert_eq!(reward_whole_notf(50_001), 0);
    }

    #[test]
    fn commitment_vector() {
        let hash = commitment_hash(
            "loc-test",
            48_856_600,
            2_352_200,
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        );
        assert_eq!(
            hex_encode(&hash),
            "b2f86af8d31a55c38dee60ad76e41ae31e3c7ccff1af6916b8e0c399ab4ebb94"
        );
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
}
