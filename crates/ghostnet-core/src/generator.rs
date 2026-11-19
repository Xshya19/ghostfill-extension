use wasm_bindgen::prelude::*;

const FIRST_NAMES: &[&str] = &[
    "james", "emma", "liam", "olivia", "noah", "ava", "ethan", "sophia", "mason", "isabella",
    "logan", "mia", "lucas", "charlotte", "alex", "harper", "daniel", "amelia", "henry", "ella",
    "jack", "grace", "owen", "lily", "ryan", "zoey", "caleb", "aria", "nathan", "samuel",
];

const LAST_NAMES: &[&str] = &[
    "smith", "johnson", "williams", "brown", "jones", "garcia", "miller", "davis", "rodriguez",
    "martinez", "hernandez", "lopez", "gonzalez", "wilson", "anderson", "thomas", "taylor", "moore",
    "jackson", "martin", "lee", "perez", "thompson", "white", "harris", "sanchez", "clark", "ramirez",
    "lewis", "robinson", "walker", "young", "allen", "king", "wright", "scott", "torres", "nguyen",
    "hill", "flores", "green", "adams", "nelson", "baker", "hall", "rivera", "campbell", "mitchell",
];

#[wasm_bindgen]
pub fn generate_human_like_username(seed: u32) -> String {
    let fn_idx = (seed as usize) % FIRST_NAMES.len();
    let ln_idx = ((seed >> 5) as usize) % LAST_NAMES.len();
    let first = FIRST_NAMES[fn_idx];
    let last = LAST_NAMES[ln_idx];
    let style = (seed >> 10) % 5;
    let year = 1970 + ((seed >> 13) % 40);

    match style {
        0 => format!("{}.{}{}", first, last, year % 100),
        1 => format!("{}{}", first, last),
        2 => format!("{}_{}", first, last),
        3 => format!("{}.{}.{}", &first[..1], &last[..1], last),
        _ => format!("{}{}", &first[..1], last),
    }
}
