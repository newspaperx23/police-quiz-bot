import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { sendIndividualQuiz } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/**
 * POST /api/send-quiz
 * Scheduled quiz dispatcher. Secured by CRON_SECRET bearer token.
 * 
 * Runs periodic checks (e.g. every 10 mins) and sends quizzes to users
 * who are due based on their individual quizInterval (in minutes).
 */
export async function POST(request: NextRequest) {
  return handleDispatch(request);
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

async function handleDispatch(request: NextRequest) {
  try {
    // ─── Auth check (supports Vercel Cron, GitHub Actions, and Admin Dashboard) ──
    const authHeader = request.headers.get("authorization");
    const expectedCronToken = `Bearer ${process.env.CRON_SECRET}`;
    const expectedAdminToken = `Bearer ${process.env.ADMIN_PASSWORD}`;
    const isVercelCron = request.headers.get("x-vercel-cron") === "true";

    const isAuthorized =
      isVercelCron ||
      authHeader === expectedCronToken ||
      (process.env.ADMIN_PASSWORD && authHeader === expectedAdminToken);

    if (!isAuthorized) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── Fetch awake users ────────────────────────────
    const snapshot = await db
      .collection("users")
      .where("isAwake", "==", true)
      .get();

    if (snapshot.empty) {
      return Response.json({ message: "No awake users", sent: 0 });
    }

    let sentCount = 0;
    let errorCount = 0;
    const now = Date.now();

    // ─── Process each user ────────────────────────────
    for (const doc of snapshot.docs) {
      const chatId = doc.id;
      const userData = doc.data();

      // Check if it's time to send quiz based on custom interval (default: 60 minutes)
      const intervalMinutes = userData.quizInterval || 60;
      const lastQuizAt = userData.lastQuizAt ? userData.lastQuizAt.toDate().getTime() : 0;
      const msPassed = now - lastQuizAt;
      const intervalMs = intervalMinutes * 60 * 1000;
      
      // Buffer of 15 seconds to prevent issues with minor cron trigger delay
      const isTime = lastQuizAt === 0 || msPassed >= (intervalMs - 15000);

      if (!isTime) {
        continue;
      }

      try {
        const success = await sendIndividualQuiz(
          chatId,
          userData.currentSubject || "สุ่มทุกวิชา",
          userData.quizzesSent || 0
        );
        if (success) {
          sentCount++;
        } else {
          errorCount++;
        }
      } catch (userError) {
        console.error(`Error processing user ${chatId}:`, userError);
        errorCount++;
      }

      // Rate limit: 200ms delay between users to prevent Telegram API throttle
      await new Promise((r) => setTimeout(r, 200));
    }

    // ─── Cleanup old active_polls (older than 7 days) ────
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const oldPolls = await db
        .collection("active_polls")
        .where("sentAt", "<", sevenDaysAgo)
        .limit(50)
        .get();
      if (!oldPolls.empty) {
        const batch = db.batch();
        oldPolls.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Cleaned up ${oldPolls.size} old active_polls`);
      }
    } catch (cleanupErr) {
      console.error("active_polls cleanup error:", cleanupErr);
    }

    return Response.json({
      message: "Quiz dispatch complete",
      sent: sentCount,
      errors: errorCount,
      total: snapshot.size,
    });
  } catch (error) {
    console.error("Send quiz error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
