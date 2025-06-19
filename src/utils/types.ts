// Interface for report processing result
export interface ProcessingResult {
  fileName: string;
  success: boolean;
  error?: string;
  retryCount?: number;
}

// export Interface for report data structure
export interface ReportData {
  date: string;
  records: any[];
  metadata: {
    totalRecords: number;
    processedAt: string;
    source: string;
  };
}

// export Interface for processing statistics
export interface ProcessingStats {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  retryCount: number;
  processingTime: number;
}