import fileConfig from '../config';

/**
 * Satu pintu untuk semua pengaturan.
 * Prioritas: environment variable > nilai di config.js.
 */
function str(envName: string, fileValue: unknown): string {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  return typeof fileValue === 'string' ? fileValue.trim() : '';
}

export const AUTH_SECRET = str('AUTH_SECRET', fileConfig.AUTH_SECRET);
export const AUTH_SECRET_OK = AUTH_SECRET.length >= 16;

const upload = Number(str('MAX_UPLOAD_MB', String(fileConfig.MAX_UPLOAD_MB)));
export const MAX_UPLOAD_MB = Number.isFinite(upload) && upload > 0 ? upload : 12;

export const DATA_DIR_SETTING = str('DATA_DIR', fileConfig.DATA_DIR);
