import { db } from "@/lib/firebase";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/**
 * POST /api/recheck-pool
 * Re-verifies a small batch of quizzes in the global pool (max 5 per call).
 * Designed to run within Vercel's 10-second serverless timeout.
 * The dashboard calls this repeatedly for full coverage.
 * 
 * Query params:
 *   subject (optional) - Only recheck a specific subject
 *   limit (optional) - Max quizzes to check (default 5, max 5)
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subjectFilter = searchParams.get("subject");
    const limitParam = parseInt(searchParams.get("limit") || "5", 10);
    // Cap at 5 to stay within Vercel's 10-second timeout on Hobby plan
    const limit = Math.min(Math.max(limitParam, 1), 5);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fetch quizzes from pool — we fetch more and filter out already-verified ones in JS
    // (Firestore can't query for missing fields, so we can't filter "verified != true" directly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db.collection("global_quizzes");
    if (subjectFilter) {
      query = query.where("subject", "==", subjectFilter);
    }
    // Fetch a larger batch (up to 1000) and filter in memory
    const rawSnapshot = await query.limit(1000).get();
    
    // Filter to only unverified quizzes
    const unverifiedDocs = rawSnapshot.docs.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc: any) => doc.data().verified !== true
    ).slice(0, limit);

    const snapshot = { docs: unverifiedDocs, empty: unverifiedDocs.length === 0 };

    if (snapshot.empty) {
      return Response.json({ 
        success: true,
        message: "No quizzes to recheck", 
        checked: 0,
        confirmed: 0,
        fixed: 0,
        deleted: 0,
        remaining: 0,
        details: [],
      });
    }

    let checkedCount = 0;
    let fixedCount = 0;
    let deletedCount = 0;
    let confirmedCount = 0;
    const details: { id: string; question: string; action: string; oldAnswer?: number; newAnswer?: number }[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const quiz = {
        question: data.question as string,
        options: data.options as string[],
        correct_option_id: data.correct_option_id as number,
      };

      // Basic validation before trying to verify
      if (!quiz.question || !quiz.options || quiz.options.length !== 4) {
        await doc.ref.delete();
        deletedCount++;
        details.push({
          id: doc.id,
          question: (quiz.question || "N/A").slice(0, 60),
          action: "DELETED (invalid structure)",
        });
        continue;
      }

      const verifyPrompt = `คุณเป็นผู้ตรวจสอบข้อสอบนายสิบตำรวจ กรุณาตรวจสอบข้อสอบต่อไปนี้อย่างละเอียด

คำถาม: ${quiz.question}

ตัวเลือก:
${quiz.options.map((opt: string, idx: number) => `${idx}. ${opt}`).join("\n")}

คำตอบที่ระบุไว้: ข้อ ${quiz.correct_option_id} (${quiz.options[quiz.correct_option_id]})

กรุณาตอบกลับเป็น JSON Object เท่านั้น:
{
  "is_correct": true,
  "correct_option_id": 0,
  "is_ambiguous": false,
  "reasoning": "เหตุผลสั้นๆ"
}

กฎ:
- is_correct: คำตอบที่ระบุไว้ถูกต้องหรือไม่ (true/false)
- correct_option_id: ตัวเลข 0-3 ที่เป็นคำตอบที่ถูกต้องจริงๆ
- is_ambiguous: ข้อสอบมีคำตอบคลุมเครือหรือถูกได้หลายข้อหรือไม่ (true/false)
- ตอบตามความรู้ที่ถูกต้องเท่านั้น อย่าเดา`;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: verifyPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 300,
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) continue;

        const result = JSON.parse(raw);
        checkedCount++;

        if (result.is_ambiguous === true) {
          // Delete ambiguous questions
          await doc.ref.delete();
          deletedCount++;
          details.push({
            id: doc.id,
            question: quiz.question.slice(0, 60),
            action: "DELETED (ambiguous)",
          });
        } else if (!result.is_correct && typeof result.correct_option_id === "number" && result.correct_option_id >= 0 && result.correct_option_id <= 3) {
          // Fix incorrect answer
          const oldAnswer = quiz.correct_option_id;
          const newAnswer = result.correct_option_id;
          await doc.ref.update({
            correct_option_id: newAnswer,
            verified: true,
            verifiedAt: new Date(),
            originalAnswer: oldAnswer,
          });
          fixedCount++;
          details.push({
            id: doc.id,
            question: quiz.question.slice(0, 60),
            action: "FIXED",
            oldAnswer,
            newAnswer,
          });
        } else {
          // Answer was correct — mark as verified
          await doc.ref.update({
            verified: true,
            verifiedAt: new Date(),
          });
          confirmedCount++;
          details.push({
            id: doc.id,
            question: quiz.question.slice(0, 60),
            action: "CONFIRMED",
          });
        }
      } catch (verifyErr) {
        console.error(`Error verifying quiz ${doc.id}:`, verifyErr);
      }
    }

    // Remaining count: we can't efficiently query this without composite index
    // The dashboard loop will stop when checked === 0
    const remainingCount = checkedCount > 0 ? -1 : 0;

    return Response.json({
      success: true,
      checked: checkedCount,
      confirmed: confirmedCount,
      fixed: fixedCount,
      deleted: deletedCount,
      remaining: remainingCount,
      details,
    });
  } catch (error) {
    console.error("Recheck pool error:", error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to recheck pool" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
