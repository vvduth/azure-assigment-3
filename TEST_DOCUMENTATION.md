# Daily Report Processor - Test Documentation

## Overview
This document describes the comprehensive test suite for the Daily Report Processor background job. The tests are designed following senior developer best practices with clean, simple, and readable code.

## Test Structure

### 1. Unit Tests
**Location**: `src/functions/dailyReportProcessor/dailyReportProcessor.test.ts`

**Coverage**:
- ✅ Successful processing scenarios
- ✅ Concurrent execution handling  
- ✅ Error handling and recovery
- ✅ Statistics and monitoring
- ✅ Environment configuration
- ✅ Integration scenarios

**Key Test Cases**:
```typescript
describe("Successful Processing", () => {
  it("should process reports successfully when everything works correctly")
  it("should handle empty report list gracefully")
  it("should log timer information correctly")
})

describe("Concurrent Execution Handling", () => {
  it("should exit early when another instance is running")
  it("should use unique lock key based on date")
})

describe("Error Handling", () => {
  it("should handle initialization errors gracefully")
  it("should handle processing errors and still clean up")
  it("should handle lock creation errors")
  it("should handle lock removal errors gracefully")
})
```

### 2. Utility Function Tests
**Location**: `src/utils/lockUtils.test.ts` & `src/utils/reportUtils.test.ts`

**Lock Utils Tests**:
- ✅ Concurrent execution detection
- ✅ Lock creation and removal
- ✅ Stale lock cleanup
- ✅ Error handling

**Report Utils Tests**:
- ✅ Container initialization
- ✅ Report file listing
- ✅ Statistics generation
- ✅ Result logging
- ✅ Mixed file type handling

### 3. Integration Tests
**Location**: `src/functions/dailyReportProcessor/integration.test.ts`

**Coverage**:
- ✅ End-to-end workflow validation
- ✅ Configuration validation
- ✅ Error scenario handling
- ✅ Performance and resource management
- ✅ Function registration verification

## Running Tests

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Only Unit Tests
```bash
npm run test:unit
```

### Run Only Integration Tests
```bash
npm run test:integration
```

### Watch Mode for Development
```bash
npm run test:watch
```

## Test Configuration

### Jest Configuration (`jest.config.js`)
- **Environment**: Node.js
- **Test Timeout**: 30 seconds
- **Coverage Threshold**: 80% lines, functions, statements; 70% branches
- **Transform**: TypeScript files using ts-jest
- **Setup**: Custom setup file for common test utilities

### Setup File (`jest.setup.js`)
- Global test utilities
- Mock Azure Functions environment
- Cleanup after each test
- Error handling for unhandled promises

## Test Best Practices Implemented

### 1. **Clean and Readable**
- Clear test descriptions using business language
- Well-organized test structure with nested describes
- Meaningful variable names and comments

### 2. **Comprehensive Coverage**
- Tests for both success and failure scenarios
- Edge cases and error conditions
- Integration scenarios combining multiple components

### 3. **Proper Mocking**
- Isolated unit tests using Jest mocks
- Proper cleanup between tests
- Mock objects that reflect real API behavior

### 4. **Senior Developer Practices**
- Arrange-Act-Assert pattern in all tests
- Single responsibility per test
- Descriptive test names that explain behavior
- Proper setup and teardown

## Sample Test Data

### Valid Report JSON
```json
{
  "date": "2024-01-15",
  "records": [
    {"id": 1, "name": "John Doe", "amount": 100.50},
    {"id": 2, "name": "Jane Smith", "amount": 250.75}
  ],
  "metadata": {
    "totalRecords": 2,
    "source": "test-system"
  }
}
```

### Invalid Report JSON (for error testing)
```json
{
  "date": "2024-01-17",
  "records": "this should be an array",
  "metadata": {}
}
```

## Coverage Reports

After running `npm run test:coverage`, you'll find detailed coverage reports in:
- `coverage/lcov-report/index.html` - HTML report
- `coverage/lcov.info` - LCOV format
- Console output - Text summary

## Expected Coverage Targets

| Component | Lines | Functions | Branches | Statements |
|-----------|-------|-----------|----------|------------|
| Daily Report Processor | >85% | >90% | >75% | >85% |
| Lock Utils | >90% | >95% | >80% | >90% |
| Report Utils | >85% | >90% | >75% | >85% |
| **Overall Target** | **>80%** | **>80%** | **>70%** | **>80%** |

## Testing Checklist

Before deploying, ensure all tests pass:

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Coverage meets minimum thresholds
- [ ] No TypeScript compilation errors
- [ ] No Jest warnings or errors
- [ ] All async operations properly handled
- [ ] Error scenarios properly tested
- [ ] Cleanup and resource management verified

## Mock Data Management

### Timer Object Mock
```typescript
const mockTimer = {
  schedule: { adjustForDST: false },
  scheduleStatus: {
    last: "2024-01-15T02:00:00Z",
    next: "2024-01-16T02:00:00Z",
    lastUpdated: "2024-01-15T02:00:00Z"
  },
  isPastDue: false
};
```

### Context Object Mock
```typescript
const mockContext = {
  invocationId: "test-invocation-123",
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
};
```

## Debugging Tests

### Common Issues and Solutions

1. **Module Import Errors**
   - Ensure TypeScript paths are correct
   - Check jest.config.js module mapping
   - Verify all dependencies are installed

2. **Async Test Failures**
   - Use proper async/await syntax
   - Increase test timeout if needed
   - Ensure all promises are properly handled

3. **Mock Issues**
   - Clear mocks between tests using `jest.clearAllMocks()`
   - Verify mock implementations match real API behavior
   - Check mock call counts and parameters

4. **Coverage Issues**
   - Review untested code paths
   - Add tests for error scenarios
   - Ensure all branches are covered

## Continuous Integration

These tests are designed to run in CI/CD pipelines:
- No external dependencies required for unit tests
- Integration tests use mocked Azure Storage
- All tests complete within reasonable time limits
- Clear error messages for debugging failures

---

*This test suite ensures the Daily Report Processor is reliable, maintainable, and ready for production deployment.*
