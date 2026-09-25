import './env';
import type { Express } from 'express';
import { createApp } from '../../src/app';

/**
 * `createApp` never calls `listen`, so Supertest drives it in-process.
 */
export function makeApp(): Express {
  return createApp();
}
