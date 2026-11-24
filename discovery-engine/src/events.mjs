import { EventEmitter } from 'node:events';

export const jccEvents = new EventEmitter();
jccEvents.setMaxListeners(50);

export function emitJccEvent(type, payload = {}) {
  jccEvents.emit(type, { type, at: new Date().toISOString(), ...payload });
}
