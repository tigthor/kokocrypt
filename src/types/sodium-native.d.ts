declare module 'sodium-native' {
  export const crypto_secretbox_NONCEBYTES: number;
  export const crypto_secretbox_MACBYTES: number;
  export const crypto_secretbox_KEYBYTES: number;

  export function randombytes_buf(buffer: Buffer): void;
  export function crypto_secretbox_easy(
    ciphertext: Buffer,
    message: Buffer,
    nonce: Buffer,
    key: Buffer
  ): void;
  export function crypto_secretbox_open_easy(
    message: Buffer,
    ciphertext: Buffer,
    nonce: Buffer,
    key: Buffer
  ): boolean;

  export function crypto_kx_keypair(publicKey: Buffer, secretKey: Buffer): void;

  export function crypto_kx_server_session_keys(
    rx: Buffer,
    tx: Buffer,
    serverPublicKey: Buffer,
    serverSecretKey: Buffer,
    clientPublicKey: Buffer
  ): void;

  export function crypto_kx_client_session_keys(
    rx: Buffer,
    tx: Buffer,
    clientPublicKey: Buffer,
    clientSecretKey: Buffer,
    serverPublicKey: Buffer
  ): void;

  export const crypto_kx_PUBLICKEYBYTES: number;
  export const crypto_kx_SECRETKEYBYTES: number;
  export const crypto_kx_SESSIONKEYBYTES: number;

  export function crypto_scalarmult_base(
    publicKey: Buffer,
    secretKey: Buffer
  ): void;

  /** constant time, true when the buffers are equal */
  export function sodium_memcmp(a: Buffer, b: Buffer): boolean;
  export function sodium_memzero(buffer: Buffer): void;

  export const crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_ABYTES: number;

  export function crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext: Buffer,
    message: Buffer,
    additionalData: Buffer | null,
    secretNonce: Buffer | null,
    publicNonce: Buffer,
    key: Buffer
  ): number;

  export function crypto_aead_xchacha20poly1305_ietf_decrypt(
    message: Buffer,
    secretNonce: Buffer | null,
    ciphertext: Buffer,
    additionalData: Buffer | null,
    publicNonce: Buffer,
    key: Buffer
  ): number;
}
