/**
 * Mirrors the backend's meeting DTOs (server dto/meeting/* — Java records,
 * so JSON keys are the record component names verbatim). Enums serialize as
 * their constant names; LocalDateTime fields arrive as ISO-8601 strings with
 * no zone (the backend stores naive local times).
 *
 * External id rule: everything participant-facing addresses a meeting by its
 * 10-char `joinCode`; only the lifecycle transitions (start/cancel/end) take
 * the internal numeric `id`.
 */

export type MeetingType = 'SCHEDULED' | 'INSTANT';

export type MeetingStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'ENDED' | 'CANCELLED';

export type ParticipantRole = 'HOST' | 'COHOST' | 'PARTICIPANT';

export type ParticipantStatus =
  | 'WAITING'
  | 'JOINED'
  | 'LEFT'
  | 'REMOVED'
  | 'DENIED'
  | 'DECLINED';

/** RoleRequest body — the backend 409s anything but these two. */
export type MeetingRoleUpdate = 'COHOST' | 'PARTICIPANT';

/**
 * Per-participant media plane credentials handed out by join/start and by
 * GET /me while JOINED + IN_PROGRESS. The LiveKit token has a ~5-minute TTL
 * and is re-minted on every /me poll — always re-read from the response,
 * never cache. `janusRoomId` equals the meeting's internal id; `muted` is the
 * participant's persisted audio-mute flag to join the bridge with.
 */
export interface MediaCredentials {
  liveKitUrl: string;
  liveKitToken: string;
  janusWsUrl: string;
  janusRoomId: number;
  janusPin: string;
  muted: boolean;
}

/**
 * Mirrors MeetingDTO. `media` is populated only by INSTANT create and
 * start — every other shape (the /my list, get-by-joinCode, cancel, end, and
 * the `meeting` embedded in MyMeetingStatusDTO) is a summary with media null
 * and the nullable timestamps absent.
 */
export interface Meeting {
  id: number;
  /** 10-char base32 external id used in every participant-facing path. */
  joinCode: string;
  title: string;
  description: string | null;
  type: MeetingType;
  status: MeetingStatus;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  waitingRoomEnabled: boolean;
  muteOnEntry: boolean;
  locked: boolean;
  /** True when the meeting was created with a password; the hash never leaves the backend. */
  hasPassword: boolean;
  /** The exclusive screen sharer's userId (null = nobody). Populated by the /me status channel only. */
  screenSharerUserId: number | null;
  hostId: number;
  hostName: string;
  media: MediaCredentials | null;
}

/** Mirrors ParticipantDTO — one row per user ever seen in the meeting. */
export interface Participant {
  userId: number;
  name: string;
  /** Feeds the stage-tile hover info card. */
  email: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  muted: boolean;
  /** Camera entitlement; a host force-off persists across rejoin, re-enable is self-only. */
  videoEnabled: boolean;
  /** Local-mic-analysis flag reported over REST; always false while muted. */
  speaking: boolean;
  /** Toolbar-toggled flag; a moderator may lower it. Rides the roster poll. */
  handRaised: boolean;
  joinCount: number;
  firstJoinedAt: string | null;
  lastJoinedAt: string | null;
  lastLeftAt: string | null;
  /** Stamped when speaking flipped false→true; orders simultaneous speakers on the stage. */
  lastSpeakingAt: string | null;
  /** Stamped when the hand went up (false→true edge); preserves raise order. */
  lastHandRaisedAt: string | null;
  admittedByName: string | null;
}

/**
 * Mirrors MyMeetingStatusDTO — the response of join and of the /me polling
 * channel. `participant` is null when the caller never touched the meeting;
 * `media` appears only while the participant is JOINED and the meeting
 * IN_PROGRESS (the waiting-room contract: poll until it shows up).
 */
export interface MyMeetingStatus {
  meeting: Meeting;
  participant: Participant | null;
  media: MediaCredentials | null;
}

/** Mirrors ChatMessageDTO. Null recipient fields = a broadcast message. */
export interface ChatMessage {
  id: number;
  senderId: number;
  senderName: string;
  recipientId: number | null;
  recipientName: string | null;
  content: string;
  sentAt: string;
}

/** Mirrors CreateMeetingRequest — validation is manual on the backend (400). */
export interface CreateMeetingRequest {
  title: string;
  description?: string | null;
  type: MeetingType;
  /** Required iff SCHEDULED; forbidden on INSTANT. */
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  waitingRoomEnabled?: boolean;
  muteOnEntry?: boolean;
  /** Optional join password, 4-100 chars after trim; blank/undefined = open meeting. */
  password?: string | null;
}

/** JoinRequest body — password omitted/null for open meetings. 403 = wrong/missing password. */
export interface JoinRequestBody {
  password?: string | null;
}

/** MuteRequest body — null would deserialize, but the UI always sends a boolean. */
export interface MuteRequestBody {
  muted: boolean;
}

/** SpeakingRequest body; the backend clamps to false while muted. */
export interface SpeakingRequestBody {
  speaking: boolean;
}

/** HandRequest body; unlike speaking there is no mute clamp. */
export interface HandRequestBody {
  handRaised: boolean;
}

/** VideoRequest body; the moderator endpoint only ever sends false. */
export interface VideoRequestBody {
  videoEnabled: boolean;
}

/** ScreenShareRequest body; the moderator endpoint only ever sends false. */
export interface ScreenShareRequestBody {
  sharing: boolean;
}

/** LockRequest body. */
export interface LockRequestBody {
  locked: boolean;
}

/** RoleRequest body. */
export interface RoleRequestBody {
  role: MeetingRoleUpdate;
}

/** SendChatRequest body — non-blank, at most 2000 characters (service-checked); recipientUserId makes it private. */
export interface SendChatRequestBody {
  content: string;
  recipientUserId?: number | null;
}
