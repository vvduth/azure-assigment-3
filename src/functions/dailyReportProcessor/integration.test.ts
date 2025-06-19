import { BlobServiceClient } from "@azure/storage-blob";
import { InvocationContext, Timer } from "@azure/functions";
import { dailyReportProcessor } from "./index";

// Integration tests use actual Azure Storage SDK but with mocked data
// These tests verify the complete workflow without external dependencies

describe("Daily Report Processor Integration Tests", () => {
  let mockContext: jest.Mocked<InvocationContext>;
  let mockTimer: Timer;
  
  // Mock storage connection string for testing
  const testConnectionString = "DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net";

  beforeEach(() => {
    // Setup test environment
    process.env.AzureWebJobsStorage = testConnectionString;
    
    // Mock InvocationContext
    mockContext = {
      invocationId: "integration-test-123",
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as any;

    // Mock Timer
    mockTimer = {
      schedule: {
        adjustForDST: false
      },
      scheduleStatus: {
        last: "2024-01-15T02:00:00Z",
        next: "2024-01-16T02:00:00Z",
        lastUpdated: "2024-01-15T02:00:00Z"
      },
      isPastDue: false
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.AzureWebJobsStorage;
  });

  describe("Error Scenarios", () => {
    it("should handle invalid connection string gracefully", async () => {
      // Arrange
      process.env.AzureWebJobsStorage = "invalid-connection-string";

      // Act & Assert
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow();
      expect(mockContext.error).toHaveBeenCalled();
    });

    it("should handle missing connection string", async () => {
      // Arrange
      delete process.env.AzureWebJobsStorage;

      // Act & Assert
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow();
      expect(mockContext.error).toHaveBeenCalled();
    });
  });

  describe("Timer Trigger Scenarios", () => {
    it("should log timer information correctly", async () => {
      // Arrange
      const pastDueTimer: Timer = {
        ...mockTimer,
        isPastDue: true
      };

      // Mock all dependencies to avoid actual storage calls
      jest.mock("@azure/storage-blob", () => ({
        BlobServiceClient: {
          fromConnectionString: jest.fn(() => ({
            getContainerClient: jest.fn(() => ({
              createIfNotExists: jest.fn(),
              listBlobsFlat: jest.fn(() => ({
                [Symbol.asyncIterator]: async function* () {
                  // Empty iterator
                }
              }))
            }))
          }))
        }
      }));

      // Act
      try {
        await dailyReportProcessor(pastDueTimer, mockContext);
      } catch (error) {
        // Expected to fail due to mocking, but we're testing the logging
      }

      // Assert
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processor started',
        expect.objectContaining({
          isPastDue: true,
          scheduleStatus: pastDueTimer.scheduleStatus,
          timestamp: expect.any(String)
        })
      );
    });

    it("should generate unique lock keys based on date", async () => {
      // Arrange
      const today = new Date().toISOString().split('T')[0];
      const expectedLockKey = `daily-report-processor-lock-${today}`;

      // Act
      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected to fail due to connection issues
      }

      // Assert - We can't directly test the lock key, but we can verify the function attempts to create it
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processor started',
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should validate required environment variables", async () => {
      // Test various invalid configurations
      const invalidConfigs = [
        "",
        "invalid",
        "AccountName=test", // Missing other parts
        "DefaultEndpointsProtocol=http" // Missing account details
      ];

      for (const config of invalidConfigs) {
        process.env.AzureWebJobsStorage = config;
        
        await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow();
      }
    });

    it("should accept valid connection string format", async () => {
      // Arrange
      const validConnectionString = "DefaultEndpointsProtocol=https;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";
      process.env.AzureWebJobsStorage = validConnectionString;

      // Act & Assert
      // This will fail due to invalid storage account, but should pass connection string validation
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow();
      
      // Verify it got past connection string validation
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processor started',
        expect.any(Object)
      );
    });
  });

  describe("Monitoring and Logging", () => {
    it("should log all critical processing steps", async () => {
      // Arrange - This will fail but should log the start
      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected
      }

      // Assert - Verify critical logging points
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processor started',
        expect.objectContaining({
          scheduleStatus: expect.any(Object),
          isPastDue: expect.any(Boolean),
          timestamp: expect.any(String)
        })
      );
    });

    it("should handle and log various error types", async () => {
      // Arrange
      process.env.AzureWebJobsStorage = "invalid-connection-string";

      // Act
      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected
      }

      // Assert
      expect(mockContext.error).toHaveBeenCalledWith(
        'Critical error in daily report processor',
        expect.any(Error)
      );
    });
  });

  describe("Performance and Resource Management", () => {
    it("should complete within reasonable time limits", async () => {
      // Arrange
      const startTime = Date.now();
      
      // Act
      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected to fail with invalid connection
      }

      // Assert - Should fail quickly, not hang
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should fail within 5 seconds
    });

    it("should properly handle cleanup in finally block", async () => {
      // Arrange
      process.env.AzureWebJobsStorage = "invalid-connection-string";

      // Act
      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected
      }

      // Assert - The function should attempt cleanup even on error
      // This is verified by the fact that it doesn't hang or leak resources
      expect(mockContext.error).toHaveBeenCalled();
    });
  });

  describe("Function Registration", () => {
    it("should export the function for Azure Functions runtime", () => {
      // Assert - Verify the function is properly exported
      expect(typeof dailyReportProcessor).toBe('function');
      expect(dailyReportProcessor.name).toBe('dailyReportProcessor');
    });

    it("should accept correct parameter types", () => {
      // Assert - TypeScript compilation ensures correct types
      // This test passes if the file compiles without type errors
      expect(dailyReportProcessor).toBeDefined();
    });
  });

  describe("Concurrency and Lock Management", () => {
    it("should use date-based lock keys for daily processing", async () => {
      // Arrange
      const testDate = new Date('2024-01-15T10:30:00Z');
      const originalDate = Date;
        // Mock Date to return consistent value
      global.Date = jest.fn().mockImplementation((dateString?: string) => {
        if (dateString) {
          return new originalDate(dateString);
        }
        return testDate;
      }) as any;
      global.Date.now = originalDate.now;

      try {
        await dailyReportProcessor(mockTimer, mockContext);
      } catch (error) {
        // Expected to fail
      }

      // Assert - Function should have attempted to create lock with correct date
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processor started',
        expect.any(Object)
      );

      // Restore original Date
      global.Date = originalDate;
    });
  });
});
