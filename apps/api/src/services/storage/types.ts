/**
 * Document storage contract (PRD §64).
 *
 * "Generated PDFs should be stored in secure object storage… Private storage,
 * Signed access URLs, Expiration, Verification code, Versioning, Access
 * logging."
 *
 * What is stored here is a citizen's proof that they paid a government charge:
 * receipts, invoices and vehicle papers. So the contract has one demand beyond
 * the obvious three, and it is the reason `put` returns rather than voids:
 *
 *   A WRITE THAT DID NOT HAPPEN MUST NOT LOOK LIKE ONE THAT DID.
 *
 * A driver returns a `StoredObject` only when the bytes are durably stored, and
 * throws otherwise. It never reports a reference for an object it failed to
 * write, because the caller records that reference against a receipt the
 * taxpayer is then told to download.
 */

export interface StoredObject {
  storageReference: string;
  byteSize: number;
  /** SHA-256 of the bytes, so a later read can be checked against the record. */
  checksum: string;
}

export interface StorageDriver {
  readonly name: string;
  /**
   * Store bytes under `key`.
   *
   * Must throw rather than return if the object is not durably stored. Callers
   * treat a returned reference as a promise that the document can be fetched.
   */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(storageReference: string): Promise<Buffer>;
  exists(storageReference: string): Promise<boolean>;
}
