import { BlobServiceClient, ContainerClient, BlobClient } from "@azure/storage-blob";
import { InvocationContext } from "@azure/functions";
import { checkConcurrentExecution, createProcessingLock, removeProcessingLock } from "./lockUtils";

// Mock Azure Storage SDK
jest.mock("@azure/storage-blob");

describe("lockUtils", () => {
  let mockBlobServiceClient: jest.Mocked<BlobServiceClient>;
  let mockContainerClient: jest.Mocked<ContainerClient>;
  let mockBlobClient: jest.Mocked<BlobClient>;
  let mockBlockBlobClient: jest.Mocked<any>;
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

    // Mock blob clients
    mockBlobClient = {
      exists: jest.fn(),
      delete: jest.fn(),
      deleteIfExists: jest.fn(),
      getProperties: jest.fn()
    } as any;

    mockBlockBlobClient = {
      upload: jest.fn()
    } as any;

    mockContainerClient = {
      createIfNotExists: jest.fn(),
      getBlobClient: jest.fn().mockReturnValue(mockBlobClient),
      getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient)
    } as any;

    mockBlobServiceClient = {
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient)
    } as any;
  });

  describe("checkConcurrentExecution", () => {
    it("should return false when no lock exists", async () => {
      // Arrange
      mockBlobClient.exists.mockResolvedValue(false);

      // Act
      const result = await checkConcurrentExecution(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(result).toBe(false);
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('processor-locks');
      expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith("test-lock-key");
      expect(mockBlobClient.exists).toHaveBeenCalledTimes(1);
    });

    it("should return true when active lock exists", async () => {
      // Arrange - Recent lock exists
      const recentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      mockBlobClient.exists.mockResolvedValue(true);
      mockBlobClient.getProperties.mockResolvedValue({
        lastModified: recentDate
      } as any);

      // Act
      const result = await checkConcurrentExecution(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(result).toBe(true);
      expect(mockBlobClient.getProperties).toHaveBeenCalledTimes(1);
      expect(mockBlobClient.delete).not.toHaveBeenCalled();
    });

    it("should remove stale lock and return false", async () => {
      // Arrange - Stale lock (older than 1 hour)
      const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      mockBlobClient.exists.mockResolvedValue(true);
      mockBlobClient.getProperties.mockResolvedValue({
        lastModified: staleDate
      } as any);
      mockBlobClient.delete.mockResolvedValue(undefined as any);

      // Act
      const result = await checkConcurrentExecution(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(result).toBe(false);
      expect(mockBlobClient.delete).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith('Stale lock detected, removing it');
    });

    it("should handle errors gracefully and return false", async () => {
      // Arrange - Error occurs
      const error = new Error("Storage unavailable");
      mockBlobClient.exists.mockRejectedValue(error);

      // Act
      const result = await checkConcurrentExecution(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(result).toBe(false);
      expect(mockContext.error).toHaveBeenCalledWith('Error checking concurrent execution', error);
    });
  });

  describe("createProcessingLock", () => {
    it("should create lock successfully", async () => {
      // Arrange
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);
      mockBlockBlobClient.upload.mockResolvedValue(undefined as any);

      // Act
      await createProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(mockContainerClient.createIfNotExists).toHaveBeenCalledTimes(1);
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith("test-lock-key");
      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.stringContaining('"startTime"'),
        expect.any(Number)
      );
      expect(mockContext.log).toHaveBeenCalledWith('Processing lock created successfully');
    });

    it("should include correct lock data", async () => {
      // Arrange
      const lockKey = "test-lock-key";
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);
      mockBlockBlobClient.upload.mockResolvedValue(undefined as any);

      // Act
      await createProcessingLock(mockBlobServiceClient, lockKey, mockContext);

      // Assert
      const uploadCall = mockBlockBlobClient.upload.mock.calls[0];
      const lockData = JSON.parse(uploadCall[0]);
      
      expect(lockData).toHaveProperty('startTime');
      expect(lockData).toHaveProperty('processId', 'test-123');
      expect(new Date(lockData.startTime)).toBeInstanceOf(Date);
    });

    it("should handle container creation errors", async () => {
      // Arrange
      const error = new Error("Failed to create container");
      mockContainerClient.createIfNotExists.mockRejectedValue(error);

      // Act & Assert
      await expect(createProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      )).rejects.toThrow("Failed to create container");

      expect(mockContext.error).toHaveBeenCalledWith('Error creating processing lock', error);
    });

    it("should handle upload errors", async () => {
      // Arrange
      const error = new Error("Upload failed");
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);
      mockBlockBlobClient.upload.mockRejectedValue(error);

      // Act & Assert
      await expect(createProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      )).rejects.toThrow("Upload failed");

      expect(mockContext.error).toHaveBeenCalledWith('Error creating processing lock', error);
    });
  });

  describe("removeProcessingLock", () => {
    it("should remove lock successfully", async () => {
      // Arrange
      mockBlobClient.deleteIfExists.mockResolvedValue({ succeeded: true } as any);

      // Act
      await removeProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('processor-locks');
      expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith("test-lock-key");
      expect(mockBlobClient.deleteIfExists).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith('Processing lock removed successfully');
    });

    it("should handle deletion errors gracefully", async () => {
      // Arrange
      const error = new Error("Delete failed");
      mockBlobClient.deleteIfExists.mockRejectedValue(error);

      // Act - Should not throw
      await removeProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert
      expect(mockContext.error).toHaveBeenCalledWith('Error removing processing lock', error);
    });

    it("should handle non-existent lock gracefully", async () => {
      // Arrange
      mockBlobClient.deleteIfExists.mockResolvedValue({ succeeded: false } as any);

      // Act
      await removeProcessingLock(
        mockBlobServiceClient,
        "test-lock-key",
        mockContext
      );

      // Assert - Should complete without error
      expect(mockContext.log).toHaveBeenCalledWith('Processing lock removed successfully');
    });
  });

  describe("Lock Integration Scenarios", () => {
    it("should handle complete lock lifecycle", async () => {
      // Arrange
      const lockKey = "integration-test-lock";
      
      // Setup for checkConcurrentExecution
      mockBlobClient.exists.mockResolvedValue(false);
      
      // Setup for createProcessingLock
      mockContainerClient.createIfNotExists.mockResolvedValue(undefined as any);
      mockBlockBlobClient.upload.mockResolvedValue(undefined as any);
      
      // Setup for removeProcessingLock
      mockBlobClient.deleteIfExists.mockResolvedValue({ succeeded: true } as any);

      // Act - Complete lifecycle
      const isRunning = await checkConcurrentExecution(mockBlobServiceClient, lockKey, mockContext);
      expect(isRunning).toBe(false);

      await createProcessingLock(mockBlobServiceClient, lockKey, mockContext);
      await removeProcessingLock(mockBlobServiceClient, lockKey, mockContext);

      // Assert - Verify all operations completed
      expect(mockBlobClient.exists).toHaveBeenCalledTimes(1);
      expect(mockBlockBlobClient.upload).toHaveBeenCalledTimes(1);
      expect(mockBlobClient.deleteIfExists).toHaveBeenCalledTimes(1);
    });

    it("should handle concurrent execution detection", async () => {
      // Arrange - Simulate another process already running
      const lockKey = "concurrent-test-lock";
      const recentDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      
      mockBlobClient.exists.mockResolvedValue(true);
      mockBlobClient.getProperties.mockResolvedValue({
        lastModified: recentDate
      } as any);

      // Act
      const isRunning = await checkConcurrentExecution(mockBlobServiceClient, lockKey, mockContext);

      // Assert
      expect(isRunning).toBe(true);
      expect(mockBlobClient.delete).not.toHaveBeenCalled();
    });
  });
});
