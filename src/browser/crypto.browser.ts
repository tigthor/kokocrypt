import * as sodium from 'libsodium-wrappers';

export class BrowserCryptoService {
  constructor() {}
  
  async ready(): Promise<void> {
    await sodium.ready;
  }
  
  async generateKeys(): Promise<{ publicKey: string, privateKey: string }> {
    await sodium.ready;
    const keypair = sodium.crypto_box_keypair();
    
    return {
      publicKey: sodium.to_base64(keypair.publicKey),
      privateKey: sodium.to_base64(keypair.privateKey)
    };
  }
  
  async encryptMessage(
    message: string, 
    receiverPublicKey: string, 
    senderPrivateKey: string
  ): Promise<string> {
    await sodium.ready;
    
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const messageUint8 = sodium.from_string(message);
    const publicKeyUint8 = sodium.from_base64(receiverPublicKey);
    const privateKeyUint8 = sodium.from_base64(senderPrivateKey);
    
    const encrypted = sodium.crypto_box_easy(
      messageUint8,
      nonce,
      publicKeyUint8,
      privateKeyUint8
    );
    
    const fullMessage = new Uint8Array(nonce.length + encrypted.length);
    fullMessage.set(nonce);
    fullMessage.set(encrypted, nonce.length);
    
    return sodium.to_base64(fullMessage);
  }
  
  async decryptMessage(
    encryptedMessage: string, 
    senderPublicKey: string, 
    receiverPrivateKey: string
  ): Promise<string> {
    await sodium.ready;
    
    const messageUint8 = sodium.from_base64(encryptedMessage);
    const publicKeyUint8 = sodium.from_base64(senderPublicKey);
    const privateKeyUint8 = sodium.from_base64(receiverPrivateKey);
    
    const nonce = messageUint8.slice(0, sodium.crypto_box_NONCEBYTES);
    const ciphertext = messageUint8.slice(sodium.crypto_box_NONCEBYTES);
    
    const decrypted = sodium.crypto_box_open_easy(
      ciphertext,
      nonce,
      publicKeyUint8,
      privateKeyUint8
    );
    
    return sodium.to_string(decrypted);
  }
  
  async serverHandshake(serverPublicKey: string): Promise<{
    clientPublicKey: string,
    clientPrivateKey: string,
    encryptedSessionData: string
  }> {
    await sodium.ready;
    
    const clientKeypair = sodium.crypto_box_keypair();
    const timestamp = Date.now();
    
    const sessionData = JSON.stringify({
      ts: timestamp,
      client: sodium.to_base64(clientKeypair.publicKey)
    });
    
    const serverPubKey = sodium.from_base64(serverPublicKey);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    
    const encrypted = sodium.crypto_box_easy(
      sodium.from_string(sessionData),
      nonce,
      serverPubKey,
      clientKeypair.privateKey
    );
    
    const fullMessage = new Uint8Array(nonce.length + encrypted.length);
    fullMessage.set(nonce);
    fullMessage.set(encrypted, nonce.length);
    
    return {
      clientPublicKey: sodium.to_base64(clientKeypair.publicKey),
      clientPrivateKey: sodium.to_base64(clientKeypair.privateKey),
      encryptedSessionData: sodium.to_base64(fullMessage)
    };
  }
}

export default BrowserCryptoService;
