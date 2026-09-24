import './env';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import type { LabMode } from '../../src/config/env';

export type { LabMode };

export const LAB_MODES = ['vulnerable', 'secure'] as const;

/**
 * Builds an app in the requested lab mode. `createApp` never calls `listen`,
 * so Supertest drives it in-process and both modes can be mounted side by side
 * against the same database in one run.
 */
export function makeApp(labMode: LabMode): Express {
  return createApp({ labMode });
}
