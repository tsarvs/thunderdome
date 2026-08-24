import { defineWorkspace } from 'vitest/config';

// Deliberately excludes bots/* — bot code is never built, imported, or tested by the platform.
export default defineWorkspace(['apps/*', 'packages/*', 'games/*', 'tools/*']);
