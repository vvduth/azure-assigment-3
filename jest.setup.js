// Jest setup file
// This file runs before each test file

// Mock console methods to avoid noise in test output
global.console = {
  ...console,
  // Uncomment to ignore specific console methods
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Set test environment variables
process.env.NODE_ENV = 'test';

// Mock Azure Functions environment
process.env.FUNCTIONS_WORKER_RUNTIME = 'node';

// Global test utilities
global.createMockContext = () => ({
  invocationId: 'test-invocation-123',
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
});

global.createMockTimer = () => ({
  schedule: {
    adjustForDST: false
  },
  scheduleStatus: {
    last: "2024-01-15T02:00:00Z",
    next: "2024-01-16T02:00:00Z",
    lastUpdated: "2024-01-15T02:00:00Z"
  },
  isPastDue: false
});

// Clean up environment after each test
afterEach(() => {
  // Clear all timers
  jest.clearAllTimers();
  
  // Reset modules
  jest.resetModules();
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in tests:', reason);
});
