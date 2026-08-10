/**
 * Human-Like Email Name Generator
 *
 * Generates realistic-looking email prefixes that resemble real human names
 * instead of random alphanumeric gibberish. This makes generated emails
 * less likely to be flagged as disposable/bot accounts.
 *
 * Patterns produced (examples):
 *   - "sarah.mitchell92"
 *   - "jameswilson"
 *   - "emma.r.taylor"
 *   - "d.johnson47"
 *   - "olivia_clark"
 */

import { getRandomInt } from './encryption';

// Common first names (gender-neutral mix for plausibility)
const FIRST_NAMES = [
  'james', 'emma', 'liam', 'olivia', 'noah', 'ava', 'ethan', 'sophia',
  'mason', 'isabella', 'logan', 'mia', 'lucas', 'charlotte', 'alex',
  'harper', 'daniel', 'amelia', 'henry', 'ella', 'jack', 'grace',
  'owen', 'chloe', 'ryan', 'lily', 'nathan', 'aria', 'caleb', 'zoey',
  'samuel', 'riley', 'dylan', 'nora', 'andrew', 'stella', 'david',
  'maya', 'joseph', 'elena', 'michael', 'sarah', 'kevin', 'rachel',
  'brian', 'nicole', 'scott', 'laura', 'kyle', 'megan', 'adam',
  'julia', 'tyler', 'hannah', 'mark', 'claire', 'eric', 'leah',
  'sean', 'amber', 'jake', 'brooke', 'colin', 'paige', 'derek',
  'faith', 'travis', 'ivy', 'blake', 'hazel', 'miles', 'ruby',
  'cole', 'vera', 'grant', 'iris', 'ross', 'pearl', 'wade', 'fern',
];

// Common last names
const LAST_NAMES = [
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller',
  'davis', 'rodriguez', 'martinez', 'wilson', 'anderson', 'taylor',
  'thomas', 'moore', 'jackson', 'martin', 'lee', 'thompson', 'white',
  'harris', 'clark', 'lewis', 'walker', 'hall', 'allen', 'young',
  'king', 'wright', 'hill', 'scott', 'green', 'adams', 'baker',
  'nelson', 'carter', 'mitchell', 'perez', 'roberts', 'turner',
  'phillips', 'campbell', 'parker', 'evans', 'edwards', 'collins',
  'stewart', 'morris', 'murphy', 'cook', 'rogers', 'reed', 'bell',
  'cooper', 'ward', 'cox', 'diaz', 'hayes', 'ford', 'long',
  'ross', 'wells', 'stone', 'fox', 'blake', 'cole', 'marsh',
  'pierce', 'shaw', 'watts', 'hart', 'page', 'webb', 'lane',
];

/**
 * Separator characters commonly found in real email addresses.
 */
const SEPARATORS = ['.', '_', ''];

/**
 * Generate a realistic human-like email username.
 *
 * Uses a variety of common email patterns that real people use,
 * with optional numeric suffixes for uniqueness.
 *
 * @returns A plausible email prefix such as "emma.taylor42" or "d.johnson"
 */
export function generateHumanLikeUsername(): string {
  const firstName = FIRST_NAMES[getRandomInt(0, FIRST_NAMES.length - 1)]!;
  const lastName = LAST_NAMES[getRandomInt(0, LAST_NAMES.length - 1)]!;
  const sep = SEPARATORS[getRandomInt(0, SEPARATORS.length - 1)]!;

  // Pick a pattern — weighted toward the most common real-world formats
  const pattern = getRandomInt(1, 10);

  let username: string;

  if (pattern <= 3) {
    // Pattern 1 (30%): firstname.lastname  →  "sarah.mitchell"
    username = `${firstName}${sep}${lastName}`;
  } else if (pattern <= 5) {
    // Pattern 2 (20%): firstname.lastname + 2-digit number  →  "james.wilson92"
    const num = getRandomInt(1, 99);
    username = `${firstName}${sep}${lastName}${num}`;
  } else if (pattern <= 6) {
    // Pattern 3 (10%): first-initial.lastname  →  "s.mitchell"
    username = `${firstName[0]}${sep || '.'}${lastName}`;
  } else if (pattern <= 7) {
    // Pattern 4 (10%): first-initial.lastname + number  →  "s.mitchell47"
    const num = getRandomInt(10, 99);
    username = `${firstName[0]}${sep || '.'}${lastName}${num}`;
  } else if (pattern <= 8) {
    // Pattern 5 (10%): firstname + first-initial-of-last  →  "sarahm"
    username = `${firstName}${lastName[0]}`;
  } else if (pattern <= 9) {
    // Pattern 6 (10%): firstname.middle-initial.lastname  →  "emma.r.taylor"
    const middleInitial = String.fromCharCode(getRandomInt(97, 122)); // a-z
    username = `${firstName}.${middleInitial}.${lastName}`;
  } else {
    // Pattern 7 (10%): firstname + year-like suffix  →  "olivia2024"
    const year = getRandomInt(85, 99);
    username = `${firstName}${year}`;
  }

  // Ensure the username is valid for email: lowercase, no leading/trailing dots
  return username.toLowerCase().replace(/^[._]+|[._]+$/g, '');
}
