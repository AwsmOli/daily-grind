export type TeamRole = "admin" | "member";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskVisibility = "personal" | "shared";
export type TaskHistoryEvent =
  | "status_change"
  | "created"
  | "assigned"
  | "repeat_changed"
  | "visibility_changed";

export interface TaskHistoryEntry {
  event: TaskHistoryEvent;
  status?: TaskStatus;
  detail?: string;
  changedBy: string;
  changedAt: Date | null;
}

export interface TeamPointsUnit {
  name: string;
  code: string;
  symbol: string;
}

export interface Team {
  id: string;
  name: string;
  pointsUnit: TeamPointsUnit;
  createdBy: string;
  createdAt: Date | null;
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  status: "active" | "invited" | "disabled";
  displayName: string;
  email: string;
  joinedAt: Date | null;
}

export interface TeamList {
  id: string;
  name: string;
  createdBy: string;
  archivedAt: Date | null;
}

export interface Invite {
  id: string;
  token: string;
  teamId: string;
  teamName: string;
  intendedMemberName: string;
  createdBy: string;
  usedCount: number;
  useLimit: number;
  expiresAt: Date | null;
  type: "qr" | "link";
}

export interface TaskItem {
  id: string;
  listId: string;
  title: string;
  description: string;
  status: TaskStatus;
  visibility: TaskVisibility;
  ownerUserId: string;
  assigneeUserId: string;
  pointsMinor: number;
  cooldownHours: number;
  cooldownEndsAt: Date | null;
  recurringRule: string;
  dueAt: Date | null;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  statusHistory: TaskHistoryEntry[];
}

export interface PointLedgerEntry {
  id: string;
  userId: string;
  deltaMinor: number;
  balanceAfterMinor: number;
  reasonType: "task_reward" | "manual_adjust" | "self_deduct";
  note: string;
  relatedTaskId: string;
  actorUserId: string;
  createdAt: Date | null;
}

export interface PointAccount {
  userId: string;
  balanceMinor: number;
}

export interface UserTeamSummary {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

export interface CreateTaskInput {
  listId: string;
  title: string;
  description: string;
  visibility: TaskVisibility;
  assigneeUserId: string;
  pointsMinor: number;
  cooldownHours: number;
  recurringRule: string;
  dueAt: Date | null;
}

export interface CreateTeamInput {
  name: string;
  pointsUnit: TeamPointsUnit;
}
