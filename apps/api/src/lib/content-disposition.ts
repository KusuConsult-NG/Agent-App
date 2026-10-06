/**
 * A Content-Disposition header for a file name somebody typed.
 *
 * Case evidence is downloaded under the name it was uploaded with, and that
 * name went into the header as typed: `inline; filename="<name>"`. Node
 * refuses a header carrying anything outside Latin-1, so evidence uploaded as
 * "Rasit ɗin Ladi.pdf" — a hooked letter any Hausa name may carry — stored
 * (201) and then failed every download with a 500: an investigator could see
 * the evidence listed and never open it. A name with a double quote in it
 * produced a header that ended the name at the quote.
 *
 * The header now carries the name twice, as RFC 6266 sets out: a plain ASCII
 * `filename` for the clients that read nothing else, with anything it cannot
 * hold replaced, and the exact name percent-encoded in `filename*`, which
 * every current browser prefers.
 */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
