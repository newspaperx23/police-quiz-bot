import { db } from "@/lib/firebase";
import { SUBJECT_KEYS } from "@/lib/syllabus";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats
 * Returns aggregated statistics for the dashboard.
 */
export async function GET(request: Request) {
  try {
    // Auth Check — ใช้ env var แทน hardcode
    const authHeader = request.headers.get("authorization");
    const adminPassword = process.env.ADMIN_PASSWORD || "!159951zZ"; // fallback เพื่อ backward compat
    if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── Users stats ──────────────────────────────────
    const usersSnapshot = await db.collection("users").get();
    const users = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const totalUsers = users.length;
    const awakeUsers = users.filter((u) => (u as Record<string, unknown>).isAwake === true).length;
    const sleepingUsers = totalUsers - awakeUsers;

    // ─── Subject distribution ─────────────────────────
    const subjectCounts: Record<string, number> = {};
    for (const key of SUBJECT_KEYS) {
      subjectCounts[key] = 0;
    }
    subjectCounts["สุ่มทุกวิชา"] = 0;

    for (const u of users) {
      const userData = u as Record<string, unknown>;
      const subject = (userData.currentSubject as string) || "สุ่มทุกวิชา";
      subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
    }

    // ─── Total quizzes sent ───────────────────────────
    const totalQuizzesSent = users.reduce(
      (sum, u) => sum + ((u as Record<string, unknown>).quizzesSent as number || 0),
      0
    );

    const totalQuizzesAnswered = users.reduce(
      (sum, u) => sum + ((u as Record<string, unknown>).quizzesAnswered as number || 0),
      0
    );

    const totalQuizzesCorrect = users.reduce(
      (sum, u) => sum + ((u as Record<string, unknown>).quizzesCorrect as number || 0),
      0
    );

    const totalQuizzesIncorrect = users.reduce(
      (sum, u) => sum + ((u as Record<string, unknown>).quizzesIncorrect as number || 0),
      0
    );

    // ─── Recent quiz history (last 20) ────────────────
    const historySnapshot = await db
      .collection("quiz_history")
      .orderBy("sentAt", "desc")
      .limit(20)
      .get();

    const recentQuizzes = historySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        chatId: data.chatId,
        subject: data.subject,
        question: data.question,
        correctAnswer: data.correctAnswer,
        sentAt: data.sentAt?.toDate?.()?.toISOString() || null,
      };
    });

    // ─── Daily quiz counts (last 7 days) ──────────────
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weekSnapshot = await db
      .collection("quiz_history")
      .where("sentAt", ">=", sevenDaysAgo)
      .orderBy("sentAt", "asc")
      .get();

    const dailyCounts: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      dailyCounts[key] = 0;
    }

    weekSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const sentAt = data.sentAt?.toDate?.();
      if (sentAt) {
        const key = sentAt.toISOString().split("T")[0];
        if (dailyCounts[key] !== undefined) {
          dailyCounts[key]++;
        }
      }
    });

    // ─── Quiz Pool Stats ──────────────────────────────
    const poolCountSnapshot = await db.collection("global_quizzes").count().get();
    const totalQuizzesInPool = poolCountSnapshot.data().count;

    const subjectPoolCounts: Record<string, number> = {};
    for (const key of SUBJECT_KEYS) {
      const countSub = await db
        .collection("global_quizzes")
        .where("subject", "==", key)
        .count()
        .get();
      subjectPoolCounts[key] = countSub.data().count;
    }

    return Response.json(
      {
        totalUsers,
        awakeUsers,
        sleepingUsers,
        totalQuizzesSent,
        totalQuizzesAnswered,
        totalQuizzesCorrect,
        totalQuizzesIncorrect,
        subjectCounts,
        recentQuizzes,
        dailyCounts,
        totalQuizzesInPool,
        subjectPoolCounts,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      }
    );
  } catch (error) {
    console.error("Stats API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
