import * as vscode from 'vscode';

/*
 * The PeopleCode Editor's Language Server switch (Settings > PeopleCode
 * Editor): completion, hover, signature help, Go to Definition, references,
 * the outline and validation as you type answer only while it is on. Read on
 * every request, so turning it off or on takes effect at once.
 */
export function languageFeaturesOn(): boolean {
  return vscode.workspace.getConfiguration('peoplesoft').get<boolean>('peoplecode.languageServer.enabled') ?? true;
}

/** The provider, answering nothing while the Language Server is off. */
export function gated<T extends object>(provider: T): T {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || !String(prop).startsWith('provide')) return value;
      return (...args: unknown[]) => (languageFeaturesOn() ? (value as (...a: unknown[]) => unknown).apply(target, args) : undefined);
    }
  });
}
