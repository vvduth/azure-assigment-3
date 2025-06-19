import { InvocationContext, Timer } from "@azure/functions";
import { BlobServiceClient, ContainerClient, BlobClient, BlockBlobClient } from "@azure/storage-blob";
import { dailyReportProcessor } from "../dailyReportProcessor";
import * as lockUtils from "../../utils/lockUtils";
import * as reportUtils from "../../utils/reportUtils";

// Mock dependencies
jest.mock("../../utils/lockUtils");
jest.mock("../../utils/reportUtils");
jest.mock("@azure/storage-blob");

describe("dailyReportProcessor", () => {
  let mockContext: jest.Mocked<InvocationContext>;
  let mockTimer: Timer;
  let mockBlobServiceClient: jest.Mocked<BlobServiceClient>;
  let mockContainerClient: jest.Mocked<ContainerClient>;
  let mockBlobClient: jest.Mocked<BlobClient>;
  // Setup before each test
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Mock InvocationContext with proper error method
    mockContext = {
      invocationId: "test-invocation-123",
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as any;    // Mock Timer object with correct string types for schedule status
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

    // Mock Azure Storage clients
    mockBlobClient = {
      exists: jest.fn(),
      delete: jest.fn(),
      deleteIfExists: jest.fn(),
      download: jest.fn(),
      getProperties: jest.fn(),
      setMetadata: jest.fn(),
      beginCopyFromURL: jest.fn()
    } as any;

    mockContainerClient = {
      createIfNotExists: jest.fn(),
      getBlobClient: jest.fn().mockReturnValue(mockBlobClient),
      getBlockBlobClient: jest.fn(),
      listBlobsFlat: jest.fn()
    } as any;

    mockBlobServiceClient = {
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient)
    } as any;

    // Mock BlobServiceClient.fromConnectionString
    (BlobServiceClient.fromConnectionString as jest.Mock).mockReturnValue(mockBlobServiceClient);

    // Set up environment variable
    process.env.AzureWebJobsStorage = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=test==;EndpointSuffix=core.windows.net";
  });

  // Clean up after each test
  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.AzureWebJobsStorage;
  });

  describe("Successful Processing", () => {
    it("should process reports successfully when everything works correctly", async () => {
      // Arrange - Set up successful scenario
      const mockReportFiles = [
        { name: "report1.json" },
        { name: "report2.json" }
      ];

      // Mock successful lock operations
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);

      // Mock successful report processing
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue(mockReportFiles);
      (reportUtils.processReportsWithRetry as jest.Mock).mockResolvedValue([
        { fileName: "report1.json", success: true, retryCount: 0 },
        { fileName: "report2.json", success: true, retryCount: 0 }
      ]);
      (reportUtils.generateProcessingStats as jest.Mock).mockReturnValue({
        totalFiles: 2,
        successfulFiles: 2,
        failedFiles: 0,
        retryCount: 0,
        processingTime: 1500
      });
      (reportUtils.cleanupProcessedFiles as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.logProcessingResults as jest.Mock).mockReturnValue(undefined);

      // Act - Execute the function
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Verify expected behavior
      expect(mockContext.log).toHaveBeenCalledWith("Daily report processor started", expect.any(Object));
      expect(lockUtils.checkConcurrentExecution).toHaveBeenCalledTimes(1);
      expect(lockUtils.createProcessingLock).toHaveBeenCalledTimes(1);
      expect(reportUtils.initializeContainers).toHaveBeenCalledTimes(1);
      expect(reportUtils.listReportFiles).toHaveBeenCalledTimes(1);
      expect(reportUtils.processReportsWithRetry).toHaveBeenCalledWith(
        mockBlobServiceClient,
        mockReportFiles,
        mockContext
      );
      expect(reportUtils.generateProcessingStats).toHaveBeenCalledTimes(1);
      expect(reportUtils.cleanupProcessedFiles).toHaveBeenCalledTimes(1);
      expect(lockUtils.removeProcessingLock).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith("Found 2 reports to process");
    });

    it("should handle empty report list gracefully", async () => {
      // Arrange - No reports to process
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([]);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Should exit gracefully without processing
      expect(mockContext.log).toHaveBeenCalledWith("No reports found to process");
      expect(reportUtils.processReportsWithRetry).not.toHaveBeenCalled();
      expect(lockUtils.removeProcessingLock).toHaveBeenCalledTimes(1);
    });

    it("should log timer information correctly", async () => {
      // Arrange
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([]);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Verify timer information is logged
      expect(mockContext.log).toHaveBeenCalledWith("Daily report processor started", {
        scheduleStatus: mockTimer.scheduleStatus,
        isPastDue: mockTimer.isPastDue,
        timestamp: expect.any(String)
      });
    });
  });

  describe("Concurrent Execution Handling", () => {
    it("should exit early when another instance is running", async () => {
      // Arrange - Another instance is running
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(true);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Should exit without processing
      expect(mockContext.log).toHaveBeenCalledWith("Another instance is already running. Exiting.");
      expect(lockUtils.createProcessingLock).not.toHaveBeenCalled();
      expect(reportUtils.initializeContainers).not.toHaveBeenCalled();
      expect(reportUtils.processReportsWithRetry).not.toHaveBeenCalled();
      expect(lockUtils.removeProcessingLock).not.toHaveBeenCalled();
    });

    it("should use unique lock key based on date", async () => {
      // Arrange
      const expectedLockKey = `daily-report-processor-lock-${new Date().toISOString().split('T')[0]}`;
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([]);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Verify correct lock key is used
      expect(lockUtils.checkConcurrentExecution).toHaveBeenCalledWith(
        mockBlobServiceClient,
        expectedLockKey,
        mockContext
      );
      expect(lockUtils.createProcessingLock).toHaveBeenCalledWith(
        mockBlobServiceClient,
        expectedLockKey,
        mockContext
      );
      expect(lockUtils.removeProcessingLock).toHaveBeenCalledWith(
        mockBlobServiceClient,
        expectedLockKey,
        mockContext
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle initialization errors gracefully", async () => {
      // Arrange - Container initialization fails
      const initError = new Error("Failed to initialize containers");
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockRejectedValue(initError);

      // Act & Assert - Should throw the error
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow("Failed to initialize containers");
        // Verify cleanup still happens
      expect(lockUtils.removeProcessingLock).toHaveBeenCalledTimes(1);
      expect(mockContext.error).toHaveBeenCalledWith(
        "Critical error in daily report processor",
        initError
      );
    });

    it("should handle processing errors and still clean up", async () => {
      // Arrange - Processing fails
      const processingError = new Error("Processing failed");
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([{ name: "test.json" }]);
      (reportUtils.processReportsWithRetry as jest.Mock).mockRejectedValue(processingError);

      // Act & Assert
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow("Processing failed");
        // Verify cleanup still happens even on error
      expect(lockUtils.removeProcessingLock).toHaveBeenCalledTimes(1);
      expect(mockContext.error).toHaveBeenCalledWith(
        "Critical error in daily report processor",
        processingError
      );
    });    it("should handle lock creation errors", async () => {
      // Arrange - Lock creation fails
      const lockError = new Error("Failed to create lock");
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockRejectedValue(lockError);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);

      // Act & Assert
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow("Failed to create lock");
      
      // Verify that we DON'T attempt to remove a lock that was never created
      expect(lockUtils.removeProcessingLock).not.toHaveBeenCalled();
      expect(mockContext.error).toHaveBeenCalledWith(
        "Critical error in daily report processor",
        lockError
      );
    });

    it("should handle lock removal errors gracefully", async () => {
      // Arrange - Lock removal fails but shouldn't crash the function
      const lockRemovalError = new Error("Failed to remove lock");
      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockRejectedValue(lockRemovalError);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([]);

      // Act - Should complete successfully despite lock removal failure
      await expect(dailyReportProcessor(mockTimer, mockContext)).resolves.toBeUndefined();
      
      // Verify processing completed
      expect(mockContext.log).toHaveBeenCalledWith("No reports found to process");
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should generate and log processing statistics", async () => {
      // Arrange
      const mockResults = [
        { fileName: "report1.json", success: true, retryCount: 0 },
        { fileName: "report2.json", success: false, retryCount: 2, error: "Validation failed" },
        { fileName: "report3.json", success: true, retryCount: 1 }
      ];
      const mockStats = {
        totalFiles: 3,
        successfulFiles: 2,
        failedFiles: 1,
        retryCount: 3,
        processingTime: 2500
      };

      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([
        { name: "report1.json" },
        { name: "report2.json" },
        { name: "report3.json" }
      ]);
      (reportUtils.processReportsWithRetry as jest.Mock).mockResolvedValue(mockResults);
      (reportUtils.generateProcessingStats as jest.Mock).mockReturnValue(mockStats);
      (reportUtils.cleanupProcessedFiles as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.logProcessingResults as jest.Mock).mockReturnValue(undefined);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Verify statistics are generated and logged
      expect(reportUtils.generateProcessingStats).toHaveBeenCalledWith(
        mockResults,
        expect.any(Number)
      );
      expect(reportUtils.logProcessingResults).toHaveBeenCalledWith(mockStats, mockContext);
    });
  });

  describe("Environment Configuration", () => {
    it("should handle missing storage connection string", async () => {
      // Arrange - Remove connection string
      delete process.env.AzureWebJobsStorage;
      (BlobServiceClient.fromConnectionString as jest.Mock).mockImplementation(() => {
        throw new Error("Connection string is required");
      });

      // Act & Assert
      await expect(dailyReportProcessor(mockTimer, mockContext)).rejects.toThrow("Connection string is required");
    });

    
  });

  describe("Integration Scenarios", () => {
    it("should handle mixed success and failure results", async () => {
      // Arrange - Mix of successful and failed processing
      const mockResults = [
        { fileName: "success1.json", success: true, retryCount: 0 },
        { fileName: "failed1.json", success: false, retryCount: 3, error: "Invalid format" },
        { fileName: "success2.json", success: true, retryCount: 1 },
        { fileName: "failed2.json", success: false, retryCount: 2, error: "Network timeout" }
      ];

      (lockUtils.checkConcurrentExecution as jest.Mock).mockResolvedValue(false);
      (lockUtils.createProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (lockUtils.removeProcessingLock as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.initializeContainers as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.listReportFiles as jest.Mock).mockResolvedValue([
        { name: "success1.json" },
        { name: "failed1.json" },
        { name: "success2.json" },
        { name: "failed2.json" }
      ]);
      (reportUtils.processReportsWithRetry as jest.Mock).mockResolvedValue(mockResults);
      (reportUtils.generateProcessingStats as jest.Mock).mockReturnValue({
        totalFiles: 4,
        successfulFiles: 2,
        failedFiles: 2,
        retryCount: 6,
        processingTime: 3000
      });
      (reportUtils.cleanupProcessedFiles as jest.Mock).mockResolvedValue(undefined);
      (reportUtils.logProcessingResults as jest.Mock).mockReturnValue(undefined);

      // Act
      await dailyReportProcessor(mockTimer, mockContext);

      // Assert - Verify all steps completed
      expect(reportUtils.processReportsWithRetry).toHaveBeenCalledTimes(1);
      expect(reportUtils.cleanupProcessedFiles).toHaveBeenCalledWith(
        mockBlobServiceClient,
        mockResults,
        mockContext
      );
      expect(mockContext.log).toHaveBeenCalledWith("Found 4 reports to process");
    });
  });
});
