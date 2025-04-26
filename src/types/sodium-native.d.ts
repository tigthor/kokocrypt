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
}
