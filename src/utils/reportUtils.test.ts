import { BlobServiceClient, ContainerClient, BlobItem } from "@azure/storage-blob";
import { InvocationContext } from "@azure/functions";
import {
  initializeContainers,
  listReportFiles,
  processReportsWithRetry,
  generateProcessingStats,
  cleanupProcessedFiles,
  logProcessingResults
} from "./reportUtils";
import { ProcessingResult, ProcessingStats } from "./types";

// Mock Azure Storage SDK
jest.mock("@azure/storage-blob");

describe("reportUtils", () => {
  let mockBlobServiceClient: jest.Mocked<BlobServiceClient>;
  let mockContainerClient: jest.Mocked<ContainerClient>;
  let mockContext: jest.Mocked<InvocationContext>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock context
    mockContext = {
      invocationId: "test-123",
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as any;

    mockContainerClient = {
      createIfNotExists: jest.fn(),
      listBlobsFlat: jest.fn()
    } as any;

    mockBlobServiceClient = {
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient)
    } as any;
  });

  describe("initializeContainers", () => {
    it("should initialize all required containers", async () => {
      // Arrange
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);

      // Act
      await initializeContainers(mockBlobServiceClient, mockContext);

      // Assert
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledTimes(4);
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('daily-reports');
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('processed-reports');
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('error-reports');
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('processor-locks');
      expect(mockContainerClient.createIfNotExists).toHaveBeenCalledTimes(4);
      expect(mockContext.log).toHaveBeenCalledTimes(4);
    });

    it("should handle container creation errors", async () => {
      // Arrange
      const error = new Error("Container creation failed");
      mockContainerClient.createIfNotExists.mockRejectedValue(error);

      // Act & Assert
      await expect(initializeContainers(mockBlobServiceClient, mockContext)).rejects.toThrow(
        "Container creation failed"
      );
      expect(mockContext.error).toHaveBeenCalledWith('Error initializing containers', error);
    });

    it("should log each container initialization", async () => {
      // Arrange
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);

      // Act
      await initializeContainers(mockBlobServiceClient, mockContext);

      // Assert
      expect(mockContext.log).toHaveBeenCalledWith("Container 'daily-reports' initialized");
      expect(mockContext.log).toHaveBeenCalledWith("Container 'processed-reports' initialized");
      expect(mockContext.log).toHaveBeenCalledWith("Container 'error-reports' initialized");
      expect(mockContext.log).toHaveBeenCalledWith("Container 'processor-locks' initialized");
    });
  });

  describe("listReportFiles", () => {
    it("should return only JSON files", async () => {
      // Arrange
      const mockBlobs = [
        { name: "report1.json" },
        { name: "report2.txt" },
        { name: "report3.json" },
        { name: "data.csv" },
        { name: "summary.json" }
      ];

      // Mock async iterator
      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const blob of mockBlobs) {
            yield blob;
          }
        }
      } as any);

      // Act
      const result = await listReportFiles(mockContainerClient, mockContext);

      // Assert
      expect(result).toHaveLength(3);
      expect(result.map(r => r.name)).toEqual(["report1.json", "report3.json", "summary.json"]);
    });

    it("should return empty array when no JSON files exist", async () => {
      // Arrange
      const mockBlobs = [
        { name: "data.txt" },
        { name: "report.csv" },
        { name: "summary.xml" }
      ];

      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const blob of mockBlobs) {
            yield blob;
          }
        }
      } as any);

      // Act
      const result = await listReportFiles(mockContainerClient, mockContext);

      // Assert
      expect(result).toHaveLength(0);
    });

    it("should handle listing errors", async () => {
      // Arrange
      const error = new Error("Failed to list blobs");
      mockContainerClient.listBlobsFlat.mockImplementation(() => {
        throw error;
      });

      // Act & Assert
      await expect(listReportFiles(mockContainerClient, mockContext)).rejects.toThrow(
        "Failed to list blobs"
      );
      expect(mockContext.error).toHaveBeenCalledWith('Error listing report files', error);
    });

    it("should handle empty container", async () => {
      // Arrange
      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          // Empty iterator
        }
      } as any);

      // Act
      const result = await listReportFiles(mockContainerClient, mockContext);

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe("generateProcessingStats", () => {
    it("should calculate statistics correctly", async () => {
      // Arrange
      const startTime = Date.now() - 5000; // 5 seconds ago
      const results: ProcessingResult[] = [
        { fileName: "file1.json", success: true, retryCount: 0 },
        { fileName: "file2.json", success: true, retryCount: 1 },
        { fileName: "file3.json", success: false, retryCount: 3, error: "Failed" },
        { fileName: "file4.json", success: false, retryCount: 2, error: "Invalid" },
        { fileName: "file5.json", success: true, retryCount: 0 }
      ];

      // Act
      const stats = generateProcessingStats(results, startTime);

      // Assert
      expect(stats.totalFiles).toBe(5);
      expect(stats.successfulFiles).toBe(3);
      expect(stats.failedFiles).toBe(2);
      expect(stats.retryCount).toBe(6); // 0 + 1 + 3 + 2 + 0
      expect(stats.processingTime).toBeGreaterThan(4000);
      expect(stats.processingTime).toBeLessThan(6000);
    });

    it("should handle empty results", async () => {
      // Arrange
      const startTime = Date.now() - 1000;
      const results: ProcessingResult[] = [];

      // Act
      const stats = generateProcessingStats(results, startTime);

      // Assert
      expect(stats.totalFiles).toBe(0);
      expect(stats.successfulFiles).toBe(0);
      expect(stats.failedFiles).toBe(0);
      expect(stats.retryCount).toBe(0);
      expect(stats.processingTime).toBeGreaterThan(500);
    });

    it("should handle results with undefined retry counts", async () => {
      // Arrange
      const startTime = Date.now() - 2000;
      const results: ProcessingResult[] = [
        { fileName: "file1.json", success: true }, // No retryCount
        { fileName: "file2.json", success: false, error: "Failed" } // No retryCount
      ];

      // Act
      const stats = generateProcessingStats(results, startTime);

      // Assert
      expect(stats.totalFiles).toBe(2);
      expect(stats.successfulFiles).toBe(1);
      expect(stats.failedFiles).toBe(1);
      expect(stats.retryCount).toBe(0); // Should handle undefined as 0
    });
  });

  describe("logProcessingResults", () => {
    it("should log comprehensive statistics", async () => {
      // Arrange
      const stats: ProcessingStats = {
        totalFiles: 10,
        successfulFiles: 8,
        failedFiles: 2,
        retryCount: 5,
        processingTime: 15000
      };

      // Act
      logProcessingResults(stats, mockContext);

      // Assert
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processing completed',
        {
          totalFiles: 10,
          successfulFiles: 8,
          failedFiles: 2,
          retryCount: 5,
          processingTimeMs: 15000,
          successRate: '80.00%'
        }
      );
    });

    it("should handle zero files case", async () => {
      // Arrange
      const stats: ProcessingStats = {
        totalFiles: 0,
        successfulFiles: 0,
        failedFiles: 0,
        retryCount: 0,
        processingTime: 1000
      };

      // Act
      logProcessingResults(stats, mockContext);

      // Assert
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processing completed',
        expect.objectContaining({
          successRate: '0%'
        })
      );
    });

    it("should calculate success rate correctly", async () => {
      // Arrange
      const stats: ProcessingStats = {
        totalFiles: 3,
        successfulFiles: 2,
        failedFiles: 1,
        retryCount: 1,
        processingTime: 5000
      };

      // Act
      logProcessingResults(stats, mockContext);

      // Assert
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processing completed',
        expect.objectContaining({
          successRate: '66.67%'
        })
      );
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle full processing workflow", async () => {
      // Arrange - Setup for full workflow
      const mockBlobs = [
        { name: "report1.json" },
        { name: "report2.json" }
      ];

      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);
      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const blob of mockBlobs) {
            yield blob;
          }
        }
      } as any);

      // Act - Execute workflow steps
      await initializeContainers(mockBlobServiceClient, mockContext);
      const reportFiles = await listReportFiles(mockContainerClient, mockContext);
      const stats = generateProcessingStats([
        { fileName: "report1.json", success: true, retryCount: 0 },
        { fileName: "report2.json", success: true, retryCount: 1 }
      ], Date.now() - 3000);
      logProcessingResults(stats, mockContext);

      // Assert - Verify workflow completed
      expect(reportFiles).toHaveLength(2);
      expect(stats.totalFiles).toBe(2);
      expect(stats.successfulFiles).toBe(2);
      expect(mockContext.log).toHaveBeenCalledWith(
        'Daily report processing completed',
        expect.any(Object)
      );
    });

    it("should handle error scenarios gracefully", async () => {
      // Arrange - Setup error scenario
      const initError = new Error("Initialization failed");
      mockContainerClient.createIfNotExists.mockRejectedValue(initError);

      // Act & Assert
      await expect(initializeContainers(mockBlobServiceClient, mockContext)).rejects.toThrow(
        "Initialization failed"
      );
      
      // Verify error was logged
      expect(mockContext.error).toHaveBeenCalledWith('Error initializing containers', initError);
    });

    it("should handle mixed file types correctly", async () => {
      // Arrange
      const mixedFiles = [
        { name: "valid-report.json" },
        { name: "backup.txt" },
        { name: "data-export.json" },
        { name: "readme.md" },
        { name: "config.yaml" },
        { name: "another-report.json" }
      ];

      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const file of mixedFiles) {
            yield file;
          }
        }
      } as any);

      // Act
      const jsonFiles = await listReportFiles(mockContainerClient, mockContext);

      // Assert
      expect(jsonFiles).toHaveLength(3);
      expect(jsonFiles.map(f => f.name)).toEqual([
        "valid-report.json",
        "data-export.json", 
        "another-report.json"
      ]);
    });
  });
});
