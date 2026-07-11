/**
 * Official syllabus mapping for Thai Police Academy (สายอำนวยการ)
 * Used to restrict OpenAI's exam generation scope.
 */
export const syllabusMap: Record<string, string> = {
  "ความสามารถทั่วไป":
    "อนุกรมตัวเลขและอักษร, คณิตศาสตร์พื้นฐาน (สมการ, ร้อยละ, อัตราส่วน), กำไร-ขาดทุน, ระยะทางและความเร็ว, อุปมาอุปไมย, มิติสัมพันธ์ ,สมการ หัวสัตว์ ขาสัตว์",
  "ภาษาไทย":
    "การอ่านจับใจความ, สรุปและตีความ, เรียงลำดับประโยค, หลักภาษาเบื้องต้น, คำเป็นคำตาย, การสะกดคำ, คำราชาศัพท์",
  "ภาษาอังกฤษ":
    "Grammar (Tenses, Subject-Verb Agreement, If-clause), Vocabulary, Reading Comprehension, Conversation พื้นฐานในชีวิตประจำวัน",
  "คอมพิวเตอร์":
    "Hardware/Software, Windows OS, การใช้งาน Microsoft Word, Excel, PowerPoint, เครือข่ายอินเทอร์เน็ต, Cybersecurity เบื้องต้น",
  "กฎหมาย":
    "ประมวลกฎหมายอาญาเบื้องต้น, กฎหมายแพ่งและพาณิชย์เบื้องต้น, รัฐธรรมนูญแห่งราชอาณาจักรไทยฉบับปัจจุบัน, พ.ร.บ.ตำรวจแห่งชาติ",
  "สังคม":
    "หลักธรรมทางศาสนาเบื้องต้น, วัฒนธรรมประเพณีไทย, ข่าวสารสถานการณ์ปัจจุบัน, ความรู้เกี่ยวกับประชาคมอาเซียน",
  "ระเบียบงานสารบรรณ":
    "ระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ (การรับ-ส่ง หนังสือราชการ, ชนิดของหนังสือ, การเก็บรักษาและทำลายหนังสือ), และระเบียบสำนักงานตำรวจแห่งชาติว่าด้วยประมวลระเบียบการตำรวจไม่เกี่ยวกับคดี ลักษณะที่ 54 งานสารบรรณ",
  "สุ่มทุกวิชา":
    "สุ่มเลือกหัวข้อจาก ความสามารถทั่วไป, ภาษาไทย, ภาษาอังกฤษ, คอมพิวเตอร์, กฎหมาย, สังคม หรือ ระเบียบงานสารบรรณ",
};

/** All subjects except the random option */
export const SUBJECT_KEYS = Object.keys(syllabusMap).filter(
  (k) => k !== "สุ่มทุกวิชา"
);

/** Pick a random subject key from the pool */
export function getRandomSubject(): string {
  return SUBJECT_KEYS[Math.floor(Math.random() * SUBJECT_KEYS.length)];
}
