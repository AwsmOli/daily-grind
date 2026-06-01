import type { User } from "firebase/auth";
import { updateProfile } from "firebase/auth";
import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import type {
  CreateTaskInput,
  CreateTeamInput,
  Invite,
  PointAccount,
  PointLedgerEntry,
  TaskHistoryEntry,
  TaskHistoryEvent,
  TaskItem,
  TaskStatus,
  Team,
  TeamList,
  TeamMember,
  TeamRole,
  UserTeamSummary,
} from "../types/domain";
import { db, functionsClient } from "./firebase";
import { randomToken } from "./id";
import { asDate } from "./mappers";

const ensureDb = () => {
  if (!db)
    throw new Error(
      "Firebase is not configured. Check .env.local and restart dev server.",
    );
  return db;
};

const normalizeToken = (value: string): string => value.trim().toUpperCase();

const memberRef = (teamId: string, userId: string) =>
  doc(ensureDb(), `teams/${teamId}/members/${userId}`);
const accountRef = (teamId: string, userId: string) =>
  doc(ensureDb(), `teams/${teamId}/pointAccounts/${userId}`);

const taskToModel = (
  taskId: string,
  data: Record<string, unknown>,
): TaskItem => {
  return {
    id: taskId,
    listId: String(data.listId ?? "default"),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    status: (data.status as TaskStatus) ?? "todo",
    visibility: (data.visibility as TaskItem["visibility"]) ?? "shared",
    ownerUserId: String(data.ownerUserId ?? ""),
    assigneeUserId: String(data.assigneeUserId ?? ""),
    pointsMinor: Number(data.pointsMinor ?? 0),
    cooldownHours: Number(data.cooldownHours ?? 0),
    cooldownEndsAt: asDate(data.cooldownEndsAt),
    recurringRule: String(data.recurringRule ?? ""),
    dueAt: asDate(data.dueAt),
    createdBy: String(data.createdBy ?? ""),
    createdAt: asDate(data.createdAt),
    updatedAt: asDate(data.updatedAt),
    statusHistory: Array.isArray(data.statusHistory)
      ? (data.statusHistory as Record<string, unknown>[]).map(
          (entry): TaskHistoryEntry => ({
            event: (entry.event as TaskHistoryEvent) ?? "status_change",
            status: entry.status ? (entry.status as TaskStatus) : undefined,
            detail: entry.detail ? String(entry.detail) : undefined,
            changedBy: String(entry.changedBy ?? ""),
            changedAt: asDate(entry.changedAt),
          }),
        )
      : [],
  };
};

export const createTeam = async (
  user: User,
  input: CreateTeamInput,
): Promise<string> => {
  const firestore = ensureDb();
  const teamRef = doc(collection(firestore, "teams"));
  const defaultListRef = doc(
    collection(firestore, `teams/${teamRef.id}/lists`),
  );
  const displayName =
    user.displayName ?? user.email?.split("@")[0] ?? "Team Lead";

  await runTransaction(firestore, async (transaction) => {
    transaction.set(teamRef, {
      name: input.name.trim(),
      pointsUnitName: input.pointsUnit.name.trim(),
      pointsUnitCode: input.pointsUnit.code.trim().toUpperCase(),
      pointsUnitSymbol: input.pointsUnit.symbol.trim(),
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });

    transaction.set(memberRef(teamRef.id, user.uid), {
      userId: user.uid,
      role: "admin",
      status: "active",
      displayName,
      email: user.email ?? "",
      joinedAt: serverTimestamp(),
    });

    transaction.set(accountRef(teamRef.id, user.uid), {
      userId: user.uid,
      balanceMinor: 0,
      updatedAt: serverTimestamp(),
    });

    transaction.set(defaultListRef, {
      name: "General",
      createdBy: user.uid,
      archivedAt: null,
      createdAt: serverTimestamp(),
    });
  });

  return teamRef.id;
};

export const createInvite = async (
  teamId: string,
  createdBy: string,
  intendedMemberName: string,
  inviteType: "qr" | "link",
): Promise<string> => {
  const firestore = ensureDb();
  const token = randomToken(10);

  await addDoc(collection(firestore, `teams/${teamId}/inviteLinks`), {
    token,
    createdBy,
    intendedMemberName: intendedMemberName.trim(),
    type: inviteType,
    useLimit: 1,
    usedCount: 0,
    expiresAt: Timestamp.fromDate(
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    ),
    createdAt: serverTimestamp(),
  });

  return token;
};

export const subscribeInvites = (
  teamId: string,
  onData: (invites: Invite[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const firestore = ensureDb();
  const q = query(
    collection(firestore, `teams/${teamId}/inviteLinks`),
    orderBy("createdAt", "desc"),
  );

  return onSnapshot(
    q,
    async (snapshot) => {
      const teamSnap = await getDoc(doc(firestore, `teams/${teamId}`));
      const teamName = String(teamSnap.data()?.name ?? "Team");

      const invites = snapshot.docs.map((entry) => {
        const data = entry.data();

        return {
          id: entry.id,
          token: String(data.token ?? ""),
          teamId,
          teamName,
          intendedMemberName: String(data.intendedMemberName ?? ""),
          createdBy: String(data.createdBy ?? ""),
          usedCount: Number(data.usedCount ?? 0),
          useLimit: Number(data.useLimit ?? 1),
          expiresAt: asDate(data.expiresAt),
          type: data.type === "qr" ? "qr" : "link",
        } as Invite;
      });

      onData(invites);
    },
    (error) => onError(error.message),
  );
};

export const redeemInvite = async (
  user: User,
  rawToken: string,
  displayNameOverride?: string,
): Promise<{ teamId: string; teamName: string }> => {
  const firestore = ensureDb();
  const token = normalizeToken(rawToken);

  const q = query(
    collectionGroup(firestore, "inviteLinks"),
    where("token", "==", token),
    limit(1),
  );
  const snapshot = await getDocs(q);

  if (!snapshot.docs.length) throw new Error("Invite code not found.");

  const inviteDoc = snapshot.docs[0];
  const inviteData = inviteDoc.data();
  const teamRef = inviteDoc.ref.parent.parent;

  if (!teamRef) throw new Error("Invalid invite data.");

  const expiresAt = asDate(inviteData.expiresAt);
  if (expiresAt && expiresAt.getTime() < Date.now())
    throw new Error("Invite has expired.");

  const usedCount = Number(inviteData.usedCount ?? 0);
  const useLimit = Number(inviteData.useLimit ?? 1);

  if (usedCount >= useLimit) throw new Error("Invite has already been used.");

  const displayName =
    displayNameOverride?.trim() ||
    user.displayName ||
    String(inviteData.intendedMemberName ?? "").trim() ||
    user.email?.split("@")[0] ||
    "Member";

  if (displayNameOverride?.trim()) {
    await updateProfile(user, { displayName: displayNameOverride.trim() });
  }

  await runTransaction(firestore, async (transaction) => {
    // All reads must come before any writes in a Firestore transaction,
    // and every document written to must also be read within the transaction.
    const freshInvite = await transaction.get(inviteDoc.ref);
    if (!freshInvite.exists()) throw new Error("Invite code not found.");
    const freshUsedCount = Number(freshInvite.data()?.usedCount ?? 0);
    const freshUseLimit = Number(freshInvite.data()?.useLimit ?? 1);
    if (freshUsedCount >= freshUseLimit)
      throw new Error("Invite has already been used.");

    const membershipDoc = memberRef(teamRef.id, user.uid);
    const existingMember = await transaction.get(membershipDoc);

    const pointsDoc = accountRef(teamRef.id, user.uid);
    const existingPoints = await transaction.get(pointsDoc);

    // Writes
    transaction.update(inviteDoc.ref, { usedCount: increment(1) });

    if (!existingMember.exists()) {
      transaction.set(membershipDoc, {
        userId: user.uid,
        role: "member",
        status: "active",
        displayName,
        email: user.email ?? "",
        joinedAt: serverTimestamp(),
      });
    }

    if (!existingPoints.exists()) {
      transaction.set(pointsDoc, {
        userId: user.uid,
        balanceMinor: 0,
        updatedAt: serverTimestamp(),
      });
    }
  });

  const teamSnapshot = await getDoc(teamRef);
  const teamName = String(teamSnapshot.data()?.name ?? "Team");

  return { teamId: teamRef.id, teamName };
};

export const subscribeUserTeams = (
  userId: string,
  onData: (teams: UserTeamSummary[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const firestore = ensureDb();
  const q = query(
    collectionGroup(firestore, "members"),
    where("userId", "==", userId),
    where("status", "==", "active"),
  );

  return onSnapshot(
    q,
    async (snapshot) => {
      const result = await Promise.all(
        snapshot.docs.map(async (memberDoc) => {
          const parentTeamRef = memberDoc.ref.parent.parent;
          if (!parentTeamRef) return null;

          const role = (memberDoc.data().role as TeamRole) ?? "member";
          const teamSnapshot = await getDoc(parentTeamRef);

          if (!teamSnapshot.exists()) return null;

          return {
            teamId: parentTeamRef.id,
            teamName: String(teamSnapshot.data().name ?? "Untitled Team"),
            role,
          } as UserTeamSummary;
        }),
      );

      onData(
        result.filter((entry): entry is UserTeamSummary => Boolean(entry)),
      );
    },
    (error) => onError(error.message),
  );
};

export const subscribeTeam = (
  teamId: string,
  onData: (team: Team | null) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  return onSnapshot(
    doc(ensureDb(), `teams/${teamId}`),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      const data = snapshot.data();
      onData({
        id: snapshot.id,
        name: String(data.name ?? ""),
        pointsUnit: {
          name: String(data.pointsUnitName ?? "Credits"),
          code: String(data.pointsUnitCode ?? "CR"),
          symbol: String(data.pointsUnitSymbol ?? ""),
        },
        createdBy: String(data.createdBy ?? ""),
        createdAt: asDate(data.createdAt),
      });
    },
    (error) => onError(error.message),
  );
};

export const subscribeTeamMember = (
  teamId: string,
  userId: string,
  onData: (member: TeamMember | null) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  return onSnapshot(
    memberRef(teamId, userId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      const data = snapshot.data();

      onData({
        userId,
        role: (data.role as TeamRole) ?? "member",
        status: (data.status as TeamMember["status"]) ?? "active",
        displayName: String(data.displayName ?? ""),
        email: String(data.email ?? ""),
        joinedAt: asDate(data.joinedAt),
      });
    },
    (error) => onError(error.message),
  );
};

export const subscribeTeamMembers = (
  teamId: string,
  onData: (members: TeamMember[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const q = query(
    collection(ensureDb(), `teams/${teamId}/members`),
    orderBy("joinedAt", "asc"),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs
          .map((entry) => {
            const data = entry.data();
            return {
              userId: String(data.userId ?? entry.id),
              role: (data.role as TeamRole) ?? "member",
              status: (data.status as TeamMember["status"]) ?? "active",
              displayName: String(data.displayName ?? ""),
              email: String(data.email ?? ""),
              joinedAt: asDate(data.joinedAt),
            };
          })
          .filter((member) => member.status === "active"),
      );
    },
    (error) => onError(error.message),
  );
};

export const subscribePointAccounts = (
  teamId: string,
  onData: (accounts: PointAccount[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const q = query(
    collection(ensureDb(), `teams/${teamId}/pointAccounts`),
    orderBy("updatedAt", "desc"),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            userId: String(data.userId ?? entry.id),
            balanceMinor: Number(data.balanceMinor ?? 0),
          };
        }),
      );
    },
    (error) => onError(error.message),
  );
};

export const createList = async (
  teamId: string,
  createdBy: string,
  name: string,
): Promise<void> => {
  await addDoc(collection(ensureDb(), `teams/${teamId}/lists`), {
    name: name.trim(),
    createdBy,
    archivedAt: null,
    createdAt: serverTimestamp(),
  });
};

export const subscribeLists = (
  teamId: string,
  onData: (lists: TeamList[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const q = query(
    collection(ensureDb(), `teams/${teamId}/lists`),
    orderBy("createdAt", "asc"),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            name: String(data.name ?? ""),
            createdBy: String(data.createdBy ?? ""),
            archivedAt: asDate(data.archivedAt),
          };
        }),
      );
    },
    (error) => onError(error.message),
  );
};

export const archiveList = async (
  teamId: string,
  listId: string,
): Promise<void> => {
  await updateDoc(doc(ensureDb(), `teams/${teamId}/lists/${listId}`), {
    archivedAt: serverTimestamp(),
  });
};

export const renameList = async (
  teamId: string,
  listId: string,
  nextName: string,
): Promise<void> => {
  const trimmed = nextName.trim();
  if (!trimmed) throw new Error("List name cannot be empty.");

  await updateDoc(doc(ensureDb(), `teams/${teamId}/lists/${listId}`), {
    name: trimmed,
    updatedAt: serverTimestamp(),
  });
};

export const removeList = async (
  teamId: string,
  listId: string,
): Promise<void> => {
  await deleteDoc(doc(ensureDb(), `teams/${teamId}/lists/${listId}`));
};

export const subscribeTasks = (
  teamId: string,
  userId: string,
  visibility: "personal" | "shared",
  onData: (tasks: TaskItem[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const firestore = ensureDb();
  const q =
    visibility === "shared"
      ? query(
          collection(firestore, `teams/${teamId}/tasks`),
          where("visibility", "==", "shared"),
        )
      : query(
          collection(firestore, `teams/${teamId}/tasks`),
          where("ownerUserId", "==", userId),
        );

  return onSnapshot(
    q,
    (snapshot) => {
      const tasks = snapshot.docs.map((entry) =>
        taskToModel(entry.id, entry.data()),
      );

      const filtered = tasks.filter((task) => {
        if (visibility === "shared") return task.visibility === "shared";
        return task.visibility === "personal" && task.ownerUserId === userId;
      });

      filtered.sort((a, b) => {
        const aTime = a.updatedAt?.getTime() ?? 0;
        const bTime = b.updatedAt?.getTime() ?? 0;
        return bTime - aTime;
      });

      onData(filtered);
    },
    (error) => onError(error.message),
  );
};

// Admin-only: subscribe to all personal tasks across the entire team (requires admin rule).
export const subscribeAllPersonalTasks = (
  teamId: string,
  onData: (tasks: TaskItem[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const q = query(
    collection(ensureDb(), `teams/${teamId}/tasks`),
    where("visibility", "==", "personal"),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const tasks = snapshot.docs.map((entry) =>
        taskToModel(entry.id, entry.data()),
      );
      tasks.sort(
        (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
      );
      onData(tasks);
    },
    (error) => onError(error.message),
  );
};

export const createTask = async (
  teamId: string,
  actorUserId: string,
  input: CreateTaskInput,
): Promise<void> => {
  const firestore = ensureDb();

  await addDoc(collection(firestore, `teams/${teamId}/tasks`), {
    listId: input.listId,
    title: input.title.trim(),
    description: input.description.trim(),
    status: "todo",
    visibility: input.visibility,
    ownerUserId: actorUserId,
    assigneeUserId: input.assigneeUserId || actorUserId,
    pointsMinor: input.pointsMinor,
    cooldownHours: input.cooldownHours,
    recurringRule: input.recurringRule.trim(),
    dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : null,
    dueNotifiedAt: null,
    cooldownEndsAt: null,
    cooldownApproachingNotifiedAt: null,
    cooldownNotifiedAt: null,
    createdBy: actorUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    statusHistory: [
      { event: "created", changedBy: actorUserId, changedAt: Timestamp.now() },
    ],
  });
};

export const setTaskStatus = async (
  teamId: string,
  taskId: string,
  actorUserId: string,
  nextStatus: TaskStatus,
): Promise<void> => {
  if (functionsClient) {
    const callable = httpsCallable<
      {
        teamId: string;
        taskId: string;
        nextStatus: TaskStatus;
      },
      { ok: boolean }
    >(functionsClient, "setTaskStatusSecure");

    await callable({
      teamId,
      taskId,
      nextStatus,
    });
    return;
  }

  const firestore = ensureDb();

  await runTransaction(firestore, async (transaction) => {
    const targetTaskRef = doc(firestore, `teams/${teamId}/tasks/${taskId}`);
    const taskDoc = await transaction.get(targetTaskRef);

    if (!taskDoc.exists()) throw new Error("Task no longer exists.");

    const taskData = taskDoc.data();
    const previousStatus = (taskData.status as TaskStatus) ?? "todo";

    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    };

    const existingAssignee = String(taskData.assigneeUserId ?? "");

    if (nextStatus === "in_progress" && !existingAssignee) {
      updatePayload.assigneeUserId = actorUserId;
    }

    if (nextStatus === "done" || nextStatus === "todo") {
      updatePayload.assigneeUserId = actorUserId;
    }

    if (nextStatus === "done") {
      const cooldownHours = Number(taskData.cooldownHours ?? 0);

      if (cooldownHours > 0) {
        const cooldownEndsAt = new Date(
          Date.now() + cooldownHours * 60 * 60 * 1000,
        );
        updatePayload.cooldownEndsAt = Timestamp.fromDate(cooldownEndsAt);
        updatePayload.cooldownApproachingNotifiedAt = null;
        updatePayload.cooldownNotifiedAt = null;
      } else {
        updatePayload.cooldownEndsAt = null;
        updatePayload.cooldownApproachingNotifiedAt = null;
        updatePayload.cooldownNotifiedAt = null;
      }
    }

    if (nextStatus === "todo") {
      updatePayload.cooldownEndsAt = null;
      updatePayload.cooldownApproachingNotifiedAt = null;
      updatePayload.cooldownNotifiedAt = null;
      updatePayload.dueNotifiedAt = null;
    }

    updatePayload.statusHistory = arrayUnion({
      event: "status_change",
      status: nextStatus,
      changedBy: actorUserId,
      changedAt: Timestamp.now(),
    });

    const shouldReward = previousStatus !== "done" && nextStatus === "done";

    const rewardUserId = String(
      updatePayload.assigneeUserId ?? taskData.assigneeUserId ?? actorUserId,
    );
    const rewardMinor = Number(taskData.pointsMinor ?? 0);

    // Read reward account before any writes (if needed)
    const rewardAccountRef =
      shouldReward && rewardMinor > 0 ? accountRef(teamId, rewardUserId) : null;
    const accountDoc = rewardAccountRef
      ? await transaction.get(rewardAccountRef)
      : null;

    // Writes
    transaction.update(targetTaskRef, updatePayload);

    if (!shouldReward || rewardMinor === 0 || !rewardAccountRef || !accountDoc)
      return;

    const currentBalance = Number(accountDoc.data()?.balanceMinor ?? 0);
    const balanceAfterMinor = currentBalance + rewardMinor;

    transaction.set(
      rewardAccountRef,
      {
        userId: rewardUserId,
        balanceMinor: balanceAfterMinor,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const ledgerRef = doc(collection(firestore, `teams/${teamId}/pointLedger`));
    transaction.set(ledgerRef, {
      userId: rewardUserId,
      deltaMinor: rewardMinor,
      balanceAfterMinor,
      reasonType: "task_reward",
      note: `Task completed: ${String(taskData.title ?? "Untitled")}`,
      relatedTaskId: taskId,
      actorUserId,
      createdAt: serverTimestamp(),
    });
  });
};

export const updateTaskMeta = async (
  teamId: string,
  taskId: string,
  actorUserId: string,
  patch: {
    title: string;
    description: string;
    assigneeUserId: string;
    pointsMinor: number;
    cooldownHours: number;
    recurringRule: string;
    dueAt: Date | null;
  },
): Promise<void> => {
  const historyEntries: unknown[] = [];
  if (patch.recurringRule !== undefined) {
    historyEntries.push({
      event: "repeat_changed",
      detail: patch.recurringRule.trim() || "none",
      changedBy: actorUserId,
      changedAt: Timestamp.now(),
    });
  }
  await updateDoc(doc(ensureDb(), `teams/${teamId}/tasks/${taskId}`), {
    title: patch.title.trim(),
    description: patch.description.trim(),
    assigneeUserId: patch.assigneeUserId,
    pointsMinor: patch.pointsMinor,
    cooldownHours: patch.cooldownHours,
    recurringRule: patch.recurringRule.trim(),
    dueAt: patch.dueAt ? Timestamp.fromDate(patch.dueAt) : null,
    dueNotifiedAt: null,
    updatedAt: serverTimestamp(),
    ...(historyEntries.length > 0
      ? { statusHistory: arrayUnion(...historyEntries) }
      : {}),
  });
};

export const setTaskVisibility = async (
  teamId: string,
  taskId: string,
  nextVisibility: "personal" | "shared",
): Promise<void> => {
  await updateDoc(doc(ensureDb(), `teams/${teamId}/tasks/${taskId}`), {
    visibility: nextVisibility,
    updatedAt: serverTimestamp(),
  });
};

export const setTaskAssignee = async (
  teamId: string,
  taskId: string,
  assigneeUserId: string,
  actorUserId: string,
): Promise<void> => {
  await updateDoc(doc(ensureDb(), `teams/${teamId}/tasks/${taskId}`), {
    assigneeUserId,
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      event: "assigned",
      detail: assigneeUserId || "unassigned",
      changedBy: actorUserId,
      changedAt: Timestamp.now(),
    }),
  });
};

export const removeTask = async (
  teamId: string,
  taskId: string,
): Promise<void> => {
  await deleteDoc(doc(ensureDb(), `teams/${teamId}/tasks/${taskId}`));
};

export const adjustPoints = async (
  teamId: string,
  targetUserId: string,
  actorUserId: string,
  deltaMinor: number,
  reasonType: "manual_adjust" | "self_deduct",
  note: string,
): Promise<void> => {
  if (!note.trim())
    throw new Error("A note is required for manual point adjustments.");

  if (functionsClient) {
    const callable = httpsCallable<
      {
        teamId: string;
        targetUserId: string;
        deltaMinor: number;
        reasonType: "manual_adjust" | "self_deduct";
        note: string;
      },
      { ok: boolean }
    >(functionsClient, "adjustPointsSecure");

    await callable({
      teamId,
      targetUserId,
      deltaMinor,
      reasonType,
      note,
    });
    return;
  }

  const firestore = ensureDb();

  await runTransaction(firestore, async (transaction) => {
    const pointsDocRef = accountRef(teamId, targetUserId);
    const accountDoc = await transaction.get(pointsDocRef);
    const currentBalance = Number(accountDoc.data()?.balanceMinor ?? 0);
    const balanceAfterMinor = currentBalance + deltaMinor;

    transaction.set(
      pointsDocRef,
      {
        userId: targetUserId,
        balanceMinor: balanceAfterMinor,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const ledgerRef = doc(collection(firestore, `teams/${teamId}/pointLedger`));
    transaction.set(ledgerRef, {
      userId: targetUserId,
      deltaMinor,
      balanceAfterMinor,
      reasonType,
      note: note.trim(),
      relatedTaskId: "",
      actorUserId,
      createdAt: serverTimestamp(),
    });
  });
};

export const subscribePointAccount = (
  teamId: string,
  userId: string,
  onData: (account: PointAccount | null) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  return onSnapshot(
    accountRef(teamId, userId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      onData({
        userId,
        balanceMinor: Number(snapshot.data().balanceMinor ?? 0),
      });
    },
    (error) => onError(error.message),
  );
};

export const subscribeLedger = (
  teamId: string,
  onData: (entries: PointLedgerEntry[]) => void,
  onError: (message: string) => void,
): Unsubscribe => {
  const q = query(
    collection(ensureDb(), `teams/${teamId}/pointLedger`),
    orderBy("createdAt", "desc"),
    limit(50),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            userId: String(data.userId ?? ""),
            deltaMinor: Number(data.deltaMinor ?? 0),
            balanceAfterMinor: Number(data.balanceAfterMinor ?? 0),
            reasonType:
              (data.reasonType as PointLedgerEntry["reasonType"]) ??
              "manual_adjust",
            note: String(data.note ?? ""),
            relatedTaskId: String(data.relatedTaskId ?? ""),
            actorUserId: String(data.actorUserId ?? ""),
            createdAt: asDate(data.createdAt),
          };
        }),
      );
    },
    (error) => onError(error.message),
  );
};

export const getTeamNameByInviteToken = async (
  rawToken: string,
): Promise<string | null> => {
  const firestore = ensureDb();
  const token = normalizeToken(rawToken);
  const q = query(
    collectionGroup(firestore, "inviteLinks"),
    where("token", "==", token),
    limit(1),
  );
  const snapshot = await getDocs(q);

  if (!snapshot.docs.length) return null;

  const teamRef = snapshot.docs[0].ref.parent.parent;
  if (!teamRef) return null;

  const teamSnapshot = await getDoc(teamRef);
  return teamSnapshot.exists()
    ? String(teamSnapshot.data().name ?? "Team")
    : null;
};

export const upsertPushToken = async (
  userId: string,
  token: string,
  platform: string,
): Promise<void> => {
  await setDoc(
    doc(ensureDb(), `users/${userId}/pushTokens/${token}`),
    {
      token,
      platform,
      enabled: true,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export const updateMemberDisplayName = async (
  teamId: string,
  userId: string,
  displayName: string,
  user: User,
): Promise<void> => {
  await Promise.all([
    updateDoc(memberRef(teamId, userId), {
      displayName,
      updatedAt: serverTimestamp(),
    }),
    updateProfile(user, { displayName }),
  ]);
};

export const setMemberRole = async (
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<void> => {
  await updateDoc(memberRef(teamId, userId), {
    role,
    updatedAt: serverTimestamp(),
  });
};

export const removeMemberFromTeam = async (
  teamId: string,
  userId: string,
): Promise<void> => {
  const firestore = ensureDb();

  await runTransaction(firestore, async (transaction) => {
    const memberDocRef = memberRef(teamId, userId);
    const accountDocRef = accountRef(teamId, userId);

    // All reads before writes
    const accountDoc = await transaction.get(accountDocRef);

    transaction.update(memberDocRef, {
      status: "disabled",
      updatedAt: serverTimestamp(),
    });

    if (accountDoc.exists()) {
      transaction.set(
        accountDocRef,
        {
          updatedAt: serverTimestamp(),
          disabledAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
};

export const updateTeamSettings = async (
  teamId: string,
  settings: {
    name: string;
    pointsUnitName: string;
    pointsUnitCode: string;
    pointsUnitSymbol: string;
  },
): Promise<void> => {
  const nextName = settings.name.trim();
  const nextPointsUnitName = settings.pointsUnitName.trim();
  const nextPointsUnitCode = settings.pointsUnitCode.trim().toUpperCase();

  if (!nextName) throw new Error("Team name is required.");
  if (!nextPointsUnitName) throw new Error("Points unit name is required.");
  if (!nextPointsUnitCode) throw new Error("Points unit code is required.");

  await updateDoc(doc(ensureDb(), `teams/${teamId}`), {
    name: nextName,
    pointsUnitName: nextPointsUnitName,
    pointsUnitCode: nextPointsUnitCode,
    pointsUnitSymbol: settings.pointsUnitSymbol.trim(),
    updatedAt: serverTimestamp(),
  });
};
