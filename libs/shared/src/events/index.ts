export class MatchRequestEvent {
  userId: string;
  level: string;
}

export class MatchFoundEvent {
  user1Id: string;
  user2Id: string;
  channelName: string;
  tokenUser1: string;
  tokenUser2: string;
}

export class MatchCancelEvent {
  userId: string;
  level: string;
}
