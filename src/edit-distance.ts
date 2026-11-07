/**
 * Edit distance between two strings, for spotting typosquatted names.
 */

/**
 * Counts the fewest single-character edits that turn `a` into `b`: inserting,
 * deleting or replacing a character, or swapping two adjacent characters.
 *
 * Counting a swap as one edit matters for typos. `lodahs` is one swap away
 * from `lodash`, but two edits away under plain Levenshtein distance.
 *
 * This is the "optimal string alignment" variant of Damerau-Levenshtein
 * distance: a substring is never edited again after being swapped. That's
 * enough for package names and needs only the last three rows of the table.
 *
 * With a `limit`, it stops as soon as the distance is certain to exceed the
 * limit and returns `limit + 1`. Callers that only ask "within N edits?"
 * then skip most of the work for names that are nothing alike.
 *
 * Runs in O(|a| × |b|) time and O(|b|) memory.
 */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // row[j] is the distance between the first i characters of a and the
  // first j characters of b. Only the current row and the two before it
  // are needed. Row 0: turning "" into b's first j characters takes j inserts.
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let previousMin = 0;

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let currentMin = i;
    for (let j = 1; j <= b.length; j++) {
      const replaceCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        previous[j]! + 1, // delete a's character
        current[j - 1]! + 1, // insert b's character
        previous[j - 1]! + replaceCost, // keep or replace
      );
      const isSwap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      if (isSwap) distance = Math.min(distance, twoBack[j - 2]! + 1);
      current[j] = distance;
      if (distance < currentMin) currentMin = distance;
    }

    // Every cell in the next row costs at least as much as some cell in this
    // row, or one more than some cell in the row before (a swap). Once both
    // bounds pass the limit, so does every later row, and the answer.
    if (currentMin > limit && previousMin + 1 > limit) return limit + 1;

    twoBack = previous;
    previous = current;
    previousMin = currentMin;
  }

  return Math.min(previous[b.length]!, limit + 1);
}
