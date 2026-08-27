import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library does not unmount between tests on its own under
// vitest's globals, and a left-mounted component keeps its fetch mocks live.
afterEach(cleanup);
