import { db } from "@/lib/firebase";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for this endpoint

/**
 * POST /api/recheck-pool
 * Re-verifies ALL existing quizzes in the global pool.
 * Fixes incorrect answers and removes ambiguous questions.
 * 
 * Query params:
 *   subject (optional) - Only recheck a specific subject
 *   limit (optional) - Max quizzes to check (default 50)
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subjectFilter = searchParams.get("subject");
    const limitParam = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fetch quizzes from pool
    let query: FirebaseFirestore.Query = db.collection("global_quizzes");
    if (subjectFilter) {
      query = query.where("subject", "==", subjectFilter);
    }
    // Prioritize unverified quizzes first
    const snapshot = await query.limit(limit).get();

    if (snapshot.empty) {
      return Response.json({ message: "No quizzes to recheck", checked: 0 });
    }

    let checkedCount = 0;
    let fixedCount = 0;
    let deletedCount = 0;
    let confirmedCount = 0;
    const details: { id: string; question: string; action: string; oldAnswer?: number; newAnswer?: number }[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const quiz = {
        question: data.question,
        options: data.options as string[],
        correct_option_id: data.correct_option_id as number,
      };

      // Skip if already verified and answer looks reasonable
      // (We still re-check all to be thorough)

      const verifyPrompt = `คุณเป็นผู้ตรวจสอบข้อสอบนายสิบตำรวจ กรุณาตรวจสอบข้อสอบต่อไปนี้อย่างละเอียด

คำถาม: ${quiz.question}

ตัวเลือก:
${quiz.options.map((opt: string, idx: number) => `${idx}. ${opt}`).join("\n")}

คำตอบที่ระบุไว้: ข้อ ${quiz.correct_option_id} (${quiz.options[quiz.correct_option_id]})

กรุณาตอบกลับเป็น JSON Object เท่านั้น:
{
  "is_correct": true/false (คำตอบที่ระบุไว้ถูกต้องหรือไม่),
  "correct_option_id": <ตัวเลข 0-3 ที่เป็นคำตอบที่ถูกต้องจริงๆ>,
  "is_ambiguous": true/false (ข้อสอบนี้มีคำตอบคลุมเครือหรือถูกได้หลายข้อหรือไม่),
  "confidence": "high"/"medium"/"low" (ระดับความมั่นใจในคำตอบ),
  "reasoning": "เหตุผลสั้นๆ"
}`;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: verifyPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 400,
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
        } else if (!result.is_correct && typeof result.correct_option_id === "number") {
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
          // Answer was correct
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

        // Rate limit: 200ms delay between verification calls
        await new Promise((r) => setTimeout(r, 200));
      } catch (verifyErr) {
        console.error(`Error verifying quiz ${doc.id}:`, verifyErr);
      }
    }

    return Response.json({
      success: true,
      checked: checkedCount,
      confirmed: confirmedCount,
      fixed: fixedCount,
      deleted: deletedCount,
      details,
    });
  } catch (error) {
    console.error("Recheck pool error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to recheck pool" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
