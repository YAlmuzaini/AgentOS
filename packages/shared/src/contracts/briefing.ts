export interface BriefingItem {
  id: string;
  title: string;
  detail: string;
  at: string;
  href: string;
}

export interface ExecutiveBriefingDto {
  projectId: string;
  since: string;
  generatedAt: string;
  decisions: BriefingItem[];
  blocked: BriefingItem[];
  completed: BriefingItem[];
  readyForReview: BriefingItem[];
  unusuallyLong: BriefingItem[];
  failures: BriefingItem[];
  continueWithoutMe: BriefingItem[];
  execution: {
    cloudSessions: number;
    cloudCostUsd: number;
    localSessions: number;
    localSubscriptionSessions: number;
    localMeteredSessions: number;
    localUnknownSessions: number;
  };
}
