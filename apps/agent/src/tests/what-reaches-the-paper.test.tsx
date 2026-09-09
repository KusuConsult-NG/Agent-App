/**
 * What a thermal printer can actually put on paper.
 *
 * `escpos.ts` had no test of any kind, and the thing it was getting wrong was
 * not subtle. It sent ASCII and replaced every other byte with `?`, so a
 * taxpayer called **Sa’idu Dan’azumi** was handed a government receipt reading
 * `Sa?idu Dan?azumi`. The apostrophe in a Nigerian name is ordinary, the name
 * on a receipt comes from the taxpayer record, and none of this needed Hausa
 * to go wrong — it was corrupting citizens' own names in English.
 *
 * It surfaced from the other direction, as the reason twelve printer strings
 * could not be translated: the Hausa writes `na’ura` and `sana’a`, so a
 * translated printer message would have reached the paper as `na?ura`. Both
 * are the same defect, and the first one is already happening.
 *
 * The test that matters here is the second one. It is not a list of examples —
 * it is every string in the dictionary, in both languages, asserted to survive
 * the encoder intact. That is the property that lets the printer be given a
 * language at all, and it holds for strings nobody has written yet.
 */

import { describe, it, expect } from 'vitest';
import { EscposBuilder, toPrintableAscii, translations } from '@psirs/shared';

/** What the printer receives, as text, with the leading `ESC @` init removed. */
function onPaper(text: string): string {
  const builder = new EscposBuilder();
  builder.text(text);
  return Array.from(builder.toUint8Array())
    .map((byte) => String.fromCharCode(byte))
    .join('')
    .replace(/^\x1b@/, '');
}

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

describe('what reaches the paper', () => {
  it('prints a name with an apostrophe as the name', () => {
    // The case this was found on, kept as itself rather than as a class.
    expect(onPaper('Sa’idu Dan’azumi')).toBe("Sa'idu Dan'azumi");
  });

  it('folds the punctuation the dictionary uses, rather than dropping it', () => {
    expect(onPaper('Bala’u — paid ₦5,000 … thanks')).toBe("Bala'u - paid NGN 5,000 ... thanks");
    expect(onPaper('“quoted”')).toBe('"quoted"');
    // An accented letter loses the accent and keeps the letter.
    expect(onPaper('José')).toBe('Jose');
  });

  it('leaves text that was already printable alone', () => {
    const plain = 'Ka tabbatar ba a biya sau biyu ba';
    expect(onPaper(plain)).toBe(plain);
    expect(toPrintableAscii(plain)).toBe(plain);
  });

  /**
   * The property, and the reason the printer can now be handed Hausa.
   *
   * Every string, both languages, not a sample. A `?` in this output is a
   * character the printer cannot render, and the only honest response to one
   * is to add it to the fold — which is why the failure names the string.
   */
  it('prints every string in the dictionary without losing a character', () => {
    const lost: string[] = [];
    for (const [language, dictionary] of [
      ['en', en],
      ['ha', ha],
    ] as const) {
      for (const [key, value] of Object.entries(dictionary)) {
        const printed = onPaper(value);
        // A `?` the source did not contain is a character that did not survive.
        if (printed.includes('?') && !value.includes('?')) {
          lost.push(`${language}.${key}: ${printed}`);
        }
      }
    }
    expect(lost).toEqual([]);
  });

  /**
   * One apostrophe, one character.
   *
   * `HAUSA-REVIEW.md` tells the reviewer that apostrophes are "written one way
   * throughout", and that was true of every string but one:
   * `paymentAcknowledgedBody` had `Naʻurar` with U+02BB where the other 331
   * use U+2019. The encoder folds both, so this is no longer a printing
   * question — it is the sheet's claim, which should be true because the
   * reviewer is relying on it.
   */
  it('writes every apostrophe the same way', () => {
    const odd: string[] = [];
    for (const [key, value] of Object.entries(ha)) {
      for (const character of value) {
        if (/[‘ʻʼ´`]/.test(character)) odd.push(`ha.${key}: ${character}`);
      }
    }
    expect(odd).toEqual([]);
  });
});
