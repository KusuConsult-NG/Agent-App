# Fonts embedded in generated documents

`LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf`.

## Why these are here rather than a system font

Every PDF this platform issues — the official revenue receipt, the invoice and
the vehicle particulars certificate — states an amount in naira. PDFKit's
built-in fonts are the base-14 Type 1 faces, which use WinAnsi encoding and have
no glyph for ₦ (U+20A6). The amount line on every receipt therefore rendered as
a broken character:

    AMOUNT PAID TO GOVERNMENT
    |3,000.00

On a document whose entire purpose is to be trustworthy evidence that a citizen
paid government revenue, the currency being unreadable is not cosmetic.

A font installed on the host would not do. The deployed container is not
guaranteed to carry one, and the failure would be silent in exactly the same way
— a receipt that renders, and is wrong.

## Why Liberation Sans

* it has a ₦ glyph, which was checked rather than assumed (see
  `src/tests/document-fonts.test.ts`, which parses the cmap table)
* it is metrically compatible with Helvetica, so the existing page layout —
  written against Helvetica's metrics — is unchanged
* at ~800 KB for both weights it is roughly half the size of the alternatives
  that also carry the glyph
* SIL Open Font License 1.1, which permits redistribution and embedding

## Licence

SIL Open Font License, Version 1.1.

    Digitized data copyright (c) 2010 Google Corporation
      with Reserved Font Name Arimo, Tinos and Cousine.
    Copyright (c) 2012 Red Hat, Inc.
      with Reserved Font Name Liberation.

Full text: https://scripts.sil.org/OFL — the licence permits bundling and
embedding, and requires that the fonts are not sold on their own and that
derivative works do not use the reserved names.

Upstream: https://github.com/liberationfonts
