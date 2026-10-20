import { parentPort } from 'node:worker_threads';
import { validatePeopleCode } from './validate.js';
import type { ValidationRequest } from './liveValidation.js';

/*
 * The thread Validate as you type compiles in (liveValidation.ts), bundled as
 * dist/validateWorker.js: the compiler is synchronous, and a large program
 * would otherwise hold up the extension host.
 */
parentPort?.on('message', (message: { id: number; request: ValidationRequest }) => {
  try {
    const { text, key, release } = message.request;
    parentPort!.postMessage({ id: message.id, result: validatePeopleCode(text, key, release) });
  } catch (error) {
    parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
