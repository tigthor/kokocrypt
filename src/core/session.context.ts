import { AsyncLocalStorage } from 'node:async_hooks';

export interface SessionKeys {
  rx: Uint8Array;
  tx: Uint8Array;
  kid: string;
  ts: number;
}

const storage = new AsyncLocalStorage<SessionKeys>();

export const SessionContext = {
  set(keys: SessionKeys, cb: () => any) {
    return storage.run(keys, cb);
  },
  
  get(): SessionKeys | undefined {
    return storage.getStore();
  },
}; 