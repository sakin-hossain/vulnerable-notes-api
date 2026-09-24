// Re-exported through a helper so `tests/helpers/env.ts` is always evaluated
// before `src/config/env.ts` reads and freezes `process.env`.
import './env';

export { errorHandler } from '../../src/middleware/error-handler';
