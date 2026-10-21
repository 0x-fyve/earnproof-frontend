/**
 * Muxed account ("M...") StrKey decoding for DISPLAY purposes only
 * (#224's "Muxed accounts and multi-operation transactions are
 * represented accurately").
 *
 * This is deliberately separate from strkey.ts's
 * `decodeEd25519PublicKey`: that module exists for signature
 * verification (decoding a "G..." address into the raw public key bytes
 * @noble/ed25519 needs) and only ever handles plain ed25519 accounts. A
 * muxed account is never itself a signing key — SEP-0023 muxed accounts
 * exist purely to attach a numeric ID to an underlying "G..." account for
 * routing/bookkeeping (e.g. which end customer a payment is for) — so
 * decoding one has nothing to do with verification and belongs in its
 * own module rather than overloading strkey.ts's narrower contract.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MUXED_ACCOUNT_VERSION_BYTE = 12 << 3; // 0x60, decodes to a leading "M"

function base32Decode(input: string): Uint8Array | null {
  const cleaned = input.toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) {
    return null;
  }

  return new Uint8Array(bytes);
}

function crc16XModem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

/** Re-encodes a decoded ed25519 public key payload back to a "G..." StrKey, for display. */
function encodeEd25519PublicKeyStrKey(publicKey: Uint8Array): string {
  const versionByte = 6 << 3; // 0x30, "G"
  const payload = new Uint8Array(1 + 32 + 2);
  payload[0] = versionByte;
  payload.set(publicKey, 1);
  const checksum = crc16XModem(payload.slice(0, 33));
  payload[33] = checksum & 0xff;
  payload[34] = (checksum >> 8) & 0xff;

  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of payload) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

export interface DecodedMuxedAccount {
  underlyingAccount: string;
  muxedId: string;
}

/**
 * Decodes a SEP-0023 muxed account ("M...") StrKey into its underlying
 * "G..." account and numeric mux ID, or null if it is not well-formed.
 * Never throws — a malformed muxed address fails closed to "could not
 * decode", which the UI represents as "unparseable," never as "same as
 * the underlying account" or any other guess.
 */
export function decodeMuxedAccount(strKey: string): DecodedMuxedAccount | null {
  if (!/^M[A-Z2-7]{68}$/.test(strKey)) {
    return null;
  }

  const decoded = base32Decode(strKey);
  // version byte (1) + public key (32) + mux id (8) + checksum (2) = 43
  if (!decoded || decoded.length !== 43) {
    return null;
  }

  const versionByte = decoded[0];
  const publicKey = decoded.slice(1, 33);
  const muxedIdBytes = decoded.slice(33, 41);
  const checksum = decoded[41] | (decoded[42] << 8);

  if (versionByte !== MUXED_ACCOUNT_VERSION_BYTE) {
    return null;
  }

  const expectedChecksum = crc16XModem(decoded.slice(0, 41));
  if (checksum !== expectedChecksum) {
    return null;
  }

  // Big-endian 8-byte unsigned integer, per SEP-0023.
  let muxedId = BigInt(0);
  for (const byte of muxedIdBytes) {
    muxedId = (muxedId << BigInt(8)) | BigInt(byte);
  }

  return {
    underlyingAccount: encodeEd25519PublicKeyStrKey(publicKey),
    muxedId: muxedId.toString(),
  };
}

export function isMuxedAccountAddress(address: string): boolean {
  return address.startsWith("M");
}
