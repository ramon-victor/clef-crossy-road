//! UTC dates without a date crate (Howard Hinnant's civil-from-days algorithm).

use std::time::{SystemTime, UNIX_EPOCH};

const SECONDS_PER_DAY: u64 = 86_400;

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The UTC calendar day, `YYYY-MM-DD`: the unit Cloudflare resets the free allocation on.
pub fn utc_day_from_unix(secs: u64) -> String {
    let (y, m, d) = civil_from_days((secs / SECONDS_PER_DAY) as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn utc_day_now() -> String {
    utc_day_from_unix(unix_now())
}

pub fn iso_from_unix(secs: u64) -> String {
    let rem = secs % SECONDS_PER_DAY;
    format!(
        "{}T{:02}:{:02}:{:02}.000Z",
        utc_day_from_unix(secs),
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

pub fn iso_now() -> String {
    iso_from_unix(unix_now())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-14 00:00:00 UTC.
    const OCT_14: u64 = 1_791_936_000;

    #[test]
    fn converts_unix_time_to_utc_dates() {
        assert_eq!(utc_day_from_unix(0), "1970-01-01");
        assert_eq!(utc_day_from_unix(951_782_400), "2000-02-29"); // leap day
        assert_eq!(utc_day_from_unix(OCT_14), "2026-10-14");
        assert_eq!(utc_day_from_unix(OCT_14 + 86_399), "2026-10-14"); // 23:59:59
        assert_eq!(utc_day_from_unix(OCT_14 - 1), "2026-10-13");
    }

    #[test]
    fn formats_timestamps_like_javascript_toisostring() {
        assert_eq!(iso_from_unix(OCT_14 + 3_661), "2026-10-14T01:01:01.000Z");
        assert_eq!(iso_from_unix(0), "1970-01-01T00:00:00.000Z");
    }
}
