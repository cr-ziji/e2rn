import type { CAC } from 'cac';

export interface InitOptions {
  in?: string;
  out?: string;
  name?: string;
  appid?: string;
  template?: string;
  runtime?: string;
  default?: boolean;
  force?: boolean;
}

export async function initCommand(options: InitOptions) {
  // TODO: implement init command (In-Process runtime by default)
  // Keep minimal stub for framework setup
  console.log('[e2rn init] In-Process runtime (Hermes/JSC) mode');
  console.log('Options:', options);
  console.log('init command framework ready. Implementation pending.');
}