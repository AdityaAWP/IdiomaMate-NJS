export interface MatchRequestEvent {
  userId: string;
  level: string;
  topics: string[];
  publishedAt: number;
}

export interface MatchFoundEvent {
  user1Id: string;
  user2Id: string;
  channelName: string;
  tokenUser1: string;
  tokenUser2: string;
  topicsUser1: string[];
  topicsUser2: string[];
  publishedAt: number;
}

export interface MatchCancelEvent {
  userId: string;
  level: string;
}
