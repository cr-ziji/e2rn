export enum ExitCode {
  success = 0,
  error = 1,
  configError = 2,
  checkFailed = 3,
  envMissing = 4,
  pluginError = 5,
}

export interface FileInfo {
  path: string;
  relativePath: string;
  content?: string;
  encoding?: BufferEncoding;
}
