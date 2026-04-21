export interface ClaimFormData {
  partnerName: string;
  budgetAllocationAmount: string;
  category: string;
  requestNumber: string;
  activityType: string;
  activity: string;
  primarySapSolution: string;
  fundRequestSubmittedDate: string;
  activityStartDate: string;
  activityEndDate: string;
}

export interface UploadedDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // base64 for binary, plain text for text files
  isText: boolean;
}

export type DecisionType = 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';
export type SeverityType = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type StatusType = 'pass' | 'fail' | 'warning' | 'missing' | 'partial';

export interface FieldValidation {
  field: string;
  label: string;
  submittedValue: string;
  extractedValue: string;
  status: StatusType;
  note: string;
}

export interface DocumentAnalysis {
  fileName: string;
  type: string;
  summary: string;
  keyDataFound: string[];
  issues: string[];
  relevance: 'high' | 'medium' | 'low';
}

export interface GuidelineCheck {
  requirement: string;
  status: StatusType;
  detail: string;
}

export interface ValidationIssue {
  severity: SeverityType;
  category: string;
  description: string;
  recommendation: string;
}

export type AiRecommendationType = 'Approve' | 'Reject' | 'Hold';

export interface AiIntelligenceAnswer {
  recommendation: AiRecommendationType;
  reason: string;
}

// Document Authenticity Signals
export type AuthenticityRiskLevel = 'Low' | 'Medium' | 'High';
export type AuthenticityConfidence = 'Low' | 'Medium' | 'High';

export interface AuthenticitySignal {
  strength: 'weak' | 'moderate' | 'strong';
  description: string;
}

export interface FileAuthenticity {
  fileName: string;
  riskLevel: AuthenticityRiskLevel;
  confidence: AuthenticityConfidence;
  conclusion: string;
  evidence: AuthenticitySignal[];
  limitations: string;
}

export interface DocumentAuthenticityResult {
  overallRiskLevel: AuthenticityRiskLevel;
  overallConfidence: AuthenticityConfidence;
  overallConclusion: string;
  files: FileAuthenticity[];
}

export interface ValidationResult {
  decision: DecisionType;
  confidence: number;
  summary: string;
  fieldValidations: FieldValidation[];
  documentAnalysis: DocumentAnalysis[];
  guidelineChecks: GuidelineCheck[];
  issues: ValidationIssue[];
  recommendations: string[];
  auditTimestamp: string;
  processingNotes: string;
  aiIntelligenceAnswer?: AiIntelligenceAnswer;
  documentAuthenticity?: DocumentAuthenticityResult;
}
