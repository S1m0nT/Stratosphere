export interface User {
  did: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  followedTopics: string[];
  preferredTags: string[];
  accessToken: string;
  refreshToken: string;
}
