"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyCooldownDue = exports.adjustPointsSecure = exports.setTaskStatusSecure = exports.sendTestPush = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
const memberDocRef = (teamId, userId) => db.doc(`teams/${teamId}/members/${userId}`);
const accountDocRef = (teamId, userId) => db.doc(`teams/${teamId}/pointAccounts/${userId}`);
const taskDocRef = (teamId, taskId) => db.doc(`teams/${teamId}/tasks/${taskId}`);
const assertAuthed = (auth) => {
    const uid = auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required.");
    }
    return uid;
};
const assertMember = async (teamId, userId) => {
    const memberSnapshot = await memberDocRef(teamId, userId).get();
    if (!memberSnapshot.exists || memberSnapshot.data()?.status !== "active") {
        throw new https_1.HttpsError("permission-denied", "User is not an active member of this team.");
    }
};
const assertAdmin = async (teamId, userId) => {
    const memberSnapshot = await memberDocRef(teamId, userId).get();
    const role = memberSnapshot.data()?.role;
    if (!memberSnapshot.exists ||
        memberSnapshot.data()?.status !== "active" ||
        role !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Admin role is required.");
    }
};
const computeNextDueAt = (recurringRule, from) => {
    const rule = recurringRule.trim().toLowerCase();
    if (!rule)
        return null;
    const next = new Date(from);
    if (rule === "every_day" || rule === "daily") {
        next.setDate(next.getDate() + 1);
        return next;
    }
    if (rule === "weekdays") {
        next.setDate(next.getDate() + 1);
        while (next.getDay() === 0 || next.getDay() === 6) {
            next.setDate(next.getDate() + 1);
        }
        return next;
    }
    const everyDaysMatch = rule.match(/^every_(\d+)_days$/);
    if (everyDaysMatch) {
        const days = Number(everyDaysMatch[1]);
        if (!Number.isFinite(days) || days <= 0)
            return null;
        next.setDate(next.getDate() + days);
        return next;
    }
    return null;
};
const collectTokens = async (userId) => {
    const tokenSnapshot = await db
        .collection(`users/${userId}/pushTokens`)
        .where("enabled", "==", true)
        .get();
    return tokenSnapshot.docs
        .map((entry) => String(entry.data().token ?? ""))
        .filter((token) => token.length > 0);
};
const sendPush = async (userId, payload) => {
    const tokens = await collectTokens(userId);
    if (!tokens.length)
        return;
    await messaging.sendEachForMulticast({
        tokens,
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: payload.data,
    });
};
exports.sendTestPush = (0, https_1.onCall)(async (request) => {
    const auth = request.auth;
    const callerUserId = assertAuthed(auth);
    const title = String(request.data?.title ?? "Daily Grind");
    const body = String(request.data?.body ?? "You have a new update.");
    await assertMember(String(request.data?.teamId ?? ""), callerUserId).catch(() => undefined);
    const tokens = await collectTokens(callerUserId);
    if (!tokens.length) {
        throw new https_1.HttpsError("not-found", "No push tokens found for this user.");
    }
    const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
            type: "manual_test",
        },
    });
    firebase_functions_1.logger.info("sendTestPush response", response);
    return {
        successCount: response.successCount,
        failureCount: response.failureCount,
    };
});
exports.setTaskStatusSecure = (0, https_1.onCall)(async (request) => {
    const callerUserId = assertAuthed(request.auth);
    const teamId = String(request.data?.teamId ?? "").trim();
    const taskId = String(request.data?.taskId ?? "").trim();
    const nextStatus = String(request.data?.nextStatus ?? "").trim();
    if (!teamId || !taskId) {
        throw new https_1.HttpsError("invalid-argument", "teamId and taskId are required.");
    }
    if (!["todo", "in_progress", "done"].includes(nextStatus)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid task status.");
    }
    await assertMember(teamId, callerUserId);
    await db.runTransaction(async (transaction) => {
        // ── All reads first ──────────────────────────────────────────────────
        const targetTaskRef = taskDocRef(teamId, taskId);
        const taskSnapshot = await transaction.get(targetTaskRef);
        if (!taskSnapshot.exists) {
            throw new https_1.HttpsError("not-found", "Task no longer exists.");
        }
        const taskData = taskSnapshot.data() ?? {};
        const previousStatus = String(taskData.status ?? "todo");
        const existingAssignee = String(taskData.assigneeUserId ?? "");
        const updatePayload = {
            status: nextStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (nextStatus === "in_progress" && !existingAssignee) {
            updatePayload.assigneeUserId = callerUserId;
        }
        if (nextStatus === "done" || nextStatus === "todo") {
            updatePayload.assigneeUserId = callerUserId;
        }
        if (nextStatus === "done") {
            const cooldownHours = Number(taskData.cooldownHours ?? 0);
            if (cooldownHours > 0) {
                const cooldownEndsAt = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);
                updatePayload.cooldownEndsAt =
                    admin.firestore.Timestamp.fromDate(cooldownEndsAt);
                updatePayload.cooldownNotifiedAt = null;
            }
            else {
                updatePayload.cooldownEndsAt = null;
                updatePayload.cooldownNotifiedAt = null;
            }
        }
        if (nextStatus === "todo") {
            updatePayload.cooldownEndsAt = null;
            updatePayload.cooldownNotifiedAt = null;
            updatePayload.dueNotifiedAt = null;
        }
        updatePayload.statusHistory = admin.firestore.FieldValue.arrayUnion({
            status: nextStatus,
            changedBy: callerUserId,
            changedAt: admin.firestore.Timestamp.now(),
        });
        // Determine reward eligibility before touching writes
        const shouldReward = previousStatus !== "done" && nextStatus === "done";
        const rewardMinor = shouldReward ? Number(taskData.pointsMinor ?? 0) : 0;
        const rewardUserId = String(updatePayload.assigneeUserId ?? taskData.assigneeUserId ?? callerUserId);
        // Read account doc before any writes (Firestore requires reads-before-writes)
        const rewardAccountRef = accountDocRef(teamId, rewardUserId);
        const rewardAccountSnapshot = shouldReward && rewardMinor > 0
            ? await transaction.get(rewardAccountRef)
            : null;
        // ── All writes after all reads ───────────────────────────────────────
        transaction.update(targetTaskRef, updatePayload);
        if (!shouldReward || rewardMinor === 0 || !rewardAccountSnapshot)
            return;
        const currentBalance = Number(rewardAccountSnapshot.data()?.balanceMinor ?? 0);
        const balanceAfterMinor = currentBalance + rewardMinor;
        transaction.set(rewardAccountRef, {
            userId: rewardUserId,
            balanceMinor: balanceAfterMinor,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        const ledgerRef = db.collection(`teams/${teamId}/pointLedger`).doc();
        transaction.set(ledgerRef, {
            userId: rewardUserId,
            deltaMinor: rewardMinor,
            balanceAfterMinor,
            reasonType: "task_reward",
            note: `Task completed: ${String(taskData.title ?? "Untitled")}`,
            relatedTaskId: taskId,
            actorUserId: callerUserId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true };
});
exports.adjustPointsSecure = (0, https_1.onCall)(async (request) => {
    const callerUserId = assertAuthed(request.auth);
    const teamId = String(request.data?.teamId ?? "").trim();
    const targetUserId = String(request.data?.targetUserId ?? "").trim();
    const reasonType = String(request.data?.reasonType ?? "").trim();
    const note = String(request.data?.note ?? "");
    const deltaMinor = Number(request.data?.deltaMinor ?? 0);
    if (!teamId || !targetUserId) {
        throw new https_1.HttpsError("invalid-argument", "teamId and targetUserId are required.");
    }
    if (!Number.isFinite(deltaMinor) || deltaMinor === 0) {
        throw new https_1.HttpsError("invalid-argument", "deltaMinor must be a non-zero number.");
    }
    if (!note.trim()) {
        throw new https_1.HttpsError("invalid-argument", "A note is required for point adjustments.");
    }
    await assertMember(teamId, callerUserId);
    if (reasonType === "self_deduct") {
        if (targetUserId !== callerUserId || deltaMinor > 0) {
            throw new https_1.HttpsError("permission-denied", "Self deduct can only deduct from your own balance.");
        }
    }
    else if (reasonType === "manual_adjust") {
        await assertAdmin(teamId, callerUserId);
    }
    else {
        throw new https_1.HttpsError("invalid-argument", "Invalid reasonType.");
    }
    await db.runTransaction(async (transaction) => {
        const targetAccountRef = accountDocRef(teamId, targetUserId);
        const accountSnapshot = await transaction.get(targetAccountRef);
        const currentBalance = Number(accountSnapshot.data()?.balanceMinor ?? 0);
        const balanceAfterMinor = currentBalance + deltaMinor;
        transaction.set(targetAccountRef, {
            userId: targetUserId,
            balanceMinor: balanceAfterMinor,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        const ledgerRef = db.collection(`teams/${teamId}/pointLedger`).doc();
        transaction.set(ledgerRef, {
            userId: targetUserId,
            deltaMinor,
            balanceAfterMinor,
            reasonType,
            note: note.trim(),
            relatedTaskId: "",
            actorUserId: callerUserId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true };
});
exports.notifyCooldownDue = (0, scheduler_1.onSchedule)("every 15 minutes", async () => {
    const now = Date.now();
    const teamsSnapshot = await db.collection("teams").get();
    for (const teamDoc of teamsSnapshot.docs) {
        const teamId = teamDoc.id;
        const dueTasksSnapshot = await db
            .collection(`teams/${teamId}/tasks`)
            .where("status", "==", "todo")
            .get();
        for (const taskDoc of dueTasksSnapshot.docs) {
            const task = taskDoc.data();
            const dueAt = task.dueAt?.toDate?.();
            const dueNotifiedAt = task.dueNotifiedAt?.toDate?.();
            const assigneeUserId = String(task.assigneeUserId ?? "");
            if (!dueAt || !assigneeUserId)
                continue;
            if (dueAt.getTime() > now)
                continue;
            if (dueNotifiedAt)
                continue;
            await sendPush(assigneeUserId, {
                title: "Task Due",
                body: `Task \"${String(task.title ?? "Untitled")}\" is due.`,
                data: {
                    type: "task_due",
                    teamId,
                    taskId: taskDoc.id,
                },
            });
            await taskDoc.ref.update({
                dueNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        const cooldownTasksSnapshot = await db
            .collection(`teams/${teamId}/tasks`)
            .where("status", "==", "done")
            .get();
        for (const taskDoc of cooldownTasksSnapshot.docs) {
            const task = taskDoc.data();
            const cooldownEndsAt = task.cooldownEndsAt?.toDate?.();
            const cooldownApproachingNotifiedAt = task.cooldownApproachingNotifiedAt?.toDate?.();
            const cooldownNotifiedAt = task.cooldownNotifiedAt?.toDate?.();
            const assigneeUserId = String(task.assigneeUserId ?? "");
            if (!cooldownEndsAt || !assigneeUserId)
                continue;
            const cooldownEndsAtMs = cooldownEndsAt.getTime();
            const approachingThresholdMs = cooldownEndsAtMs - 60 * 60 * 1000;
            if (!cooldownApproachingNotifiedAt &&
                now >= approachingThresholdMs &&
                now < cooldownEndsAtMs) {
                await sendPush(assigneeUserId, {
                    title: "Cooldown Ending Soon",
                    body: `Task \"${String(task.title ?? "Untitled")}\" will be available within 1 hour.`,
                    data: {
                        type: "cooldown_approaching",
                        teamId,
                        taskId: taskDoc.id,
                    },
                });
                await taskDoc.ref.update({
                    cooldownApproachingNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            if (cooldownEndsAtMs > now)
                continue;
            const recurringRule = String(task.recurringRule ?? "").trim();
            const nextDueAt = computeNextDueAt(recurringRule, cooldownEndsAt);
            if (nextDueAt) {
                await taskDoc.ref.update({
                    status: "todo",
                    dueAt: admin.firestore.Timestamp.fromDate(nextDueAt),
                    dueNotifiedAt: null,
                    cooldownEndsAt: null,
                    cooldownApproachingNotifiedAt: null,
                    cooldownNotifiedAt: null,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                await sendPush(assigneeUserId, {
                    title: "Recurring Task Reset",
                    body: `Task \"${String(task.title ?? "Untitled")}\" is available again.`,
                    data: {
                        type: "recurring_reset",
                        teamId,
                        taskId: taskDoc.id,
                    },
                });
                continue;
            }
            if (cooldownNotifiedAt)
                continue;
            await sendPush(assigneeUserId, {
                title: "Cooldown Ended",
                body: `Task \"${String(task.title ?? "Untitled")}\" is ready again.`,
                data: {
                    type: "cooldown_ended",
                    teamId,
                    taskId: taskDoc.id,
                },
            });
            await taskDoc.ref.update({
                cooldownNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    firebase_functions_1.logger.info("notifyCooldownDue run finished");
});
