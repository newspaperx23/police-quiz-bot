"use client";

import { useEffect, useState, useCallback } from "react";
interface StatsData {
  totalUsers: number;
  awakeUsers: number;
  sleepingUsers: number;
  totalQuizzesSent: number;
  totalQuizzesAnswered?: number;
  totalQuizzesCorrect?: number;
  totalQuizzesIncorrect?: number;
  subjectCounts: Record<string, number>;
  recentQuizzes: {
    id: string;
    chatId: string;
    subject: string;
    question: string;
    correctAnswer: string;
    sentAt: string | null;
  }[];
  dailyCounts: Record<string, number>;
  totalQuizzesInPool?: number;
  subjectPoolCounts?: Record<string, number>;
}
export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [enteredPassword, setEnteredPassword] = useState("");

  const [generating, setGenerating] = useState(false);
  const [selectedPoolSubject, setSelectedPoolSubject] = useState("ความสามารถทั่วไป");
  const [generationMsg, setGenerationMsg] = useState<string | null>(null);

  const generatePoolQuizzes = async () => {
    try {
      setGenerating(true);
      setGenerationMsg(null);
      const savedPassword = localStorage.getItem("admin_password") || password;
      const res = await fetch(`/api/generate-pool?subject=${encodeURIComponent(selectedPoolSubject)}&count=5`, {
        headers: {
          Authorization: `Bearer ${savedPassword}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      setGenerationMsg(`✅ เจนข้อสอบวิชา ${data.subject} สำเร็จ +${data.savedCount} ข้อ!`);
      // Refresh stats
      const statsRes = await fetch(`/api/stats?t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${savedPassword}`
        }
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      setGenerationMsg(`❌ เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGenerating(false);
    }
  };

  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkStatusText, setBulkStatusText] = useState<string | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  const generateBulkQuizzes = () => {
    setShowBulkConfirm(true);
  };

  const startBulkGeneration = async () => {
    const subjects = ["ความสามารถทั่วไป", "ภาษาไทย", "ภาษาอังกฤษ", "คอมพิวเตอร์", "กฎหมาย", "สังคม", "ระเบียบงานสารบรรณ"];
    const totalSteps = subjects.length * 5; // 7 subjects * 5 batches = 35 steps
    let currentStep = 0;

    setBulkGenerating(true);
    setBulkStatusText("เริ่มต้นระบบการออกข้อสอบจำนวนมาก...");
    setBulkProgress(0);

    try {
      const savedPassword = localStorage.getItem("admin_password") || password;
      for (const subject of subjects) {
        for (let batch = 1; batch <= 5; batch++) {
          setBulkStatusText(`กำลังออกข้อสอบวิชา "${subject}" (รอบที่ ${batch}/5)...`);
          
          const res = await fetch(`/api/generate-pool?subject=${encodeURIComponent(subject)}&count=10`, {
            headers: {
              Authorization: `Bearer ${savedPassword}`
            }
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || `ล้มเหลวในการออกข้อสอบวิชา ${subject} รอบที่ ${batch}`);
          }

          currentStep++;
          const percent = Math.round((currentStep / totalSteps) * 100);
          setBulkProgress(percent);
        }
      }

      setBulkStatusText("🎉 เจนข้อสอบใหม่ทุกวิชาสำเร็จ! วิชาละ +50 ข้อ (รวมทั้งหมด +350 ข้อ) และจัดเก็บในคลังโดยไม่มีการออกซ้ำเรียบร้อยแล้วครับ");
      // Refresh stats
      const statsRes = await fetch(`/api/stats?t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${savedPassword}`
        }
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      setBulkStatusText(`❌ เกิดข้อผิดพลาดกลางคัน: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBulkGenerating(false);
    }
  };

  const [recheckRunning, setRecheckRunning] = useState(false);
  const [recheckProgress, setRecheckProgress] = useState(0);
  const [recheckStatusText, setRecheckStatusText] = useState<string | null>(null);

  const startRecheckPool = async () => {
    const subjects = ["ความสามารถทั่วไป", "ภาษาไทย", "ภาษาอังกฤษ", "คอมพิวเตอร์", "กฎหมาย", "สังคม", "ระเบียบงานสารบรรณ"];
    setRecheckRunning(true);
    setRecheckProgress(0);
    setRecheckStatusText("เริ่มตรวจสอบคลังข้อสอบ...");

    let totalFixed = 0;
    let totalDeleted = 0;
    let totalConfirmed = 0;
    let totalChecked = 0;

    try {
      const savedPassword = localStorage.getItem("admin_password") || password;
      for (let i = 0; i < subjects.length; i++) {
        const subject = subjects[i];
        let batchNum = 0;
        let hasMore = true;

        // Keep calling the API in batches of 5 until no more quizzes for this subject
        while (hasMore) {
          batchNum++;
          setRecheckStatusText(`กำลังตรวจสอบวิชา "${subject}" (รอบที่ ${batchNum})...`);

          try {
            const res = await fetch(`/api/recheck-pool?subject=${encodeURIComponent(subject)}&limit=5`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${savedPassword}`
              }
            });
            
            if (!res.ok) {
              const errText = await res.text();
              console.error(`Recheck API error for ${subject}:`, errText);
              // Skip this subject on error
              break;
            }
            
            const data = await res.json();
            
            if (data.success) {
              totalFixed += data.fixed || 0;
              totalDeleted += data.deleted || 0;
              totalConfirmed += data.confirmed || 0;
              totalChecked += data.checked || 0;
            }

            // If no quizzes were checked, this subject is done
            if (!data.checked || data.checked === 0) {
              hasMore = false;
            }

            // Safety: cap at 200 batches per subject (1000 quizzes)
            if (batchNum >= 200) {
              hasMore = false;
            }
          } catch (fetchErr) {
            console.error(`Fetch error for ${subject} batch ${batchNum}:`, fetchErr);
            break;
          }
        }

        // Update progress based on subjects completed
        setRecheckProgress(Math.round(((i + 1) / subjects.length) * 100));
      }

      setRecheckStatusText(
        `✅ ตรวจสอบเสร็จสิ้น! ตรวจแล้ว ${totalChecked} ข้อ — ` +
        `ถูกต้อง: ${totalConfirmed}, แก้ไข: ${totalFixed}, ลบ: ${totalDeleted}`
      );

      // Refresh stats
      const statsRes = await fetch(`/api/stats?t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${savedPassword}`
        }
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      setRecheckStatusText(`❌ เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRecheckRunning(false);
    }
  };

  const fetchStats = useCallback(async () => {
    const savedPassword = localStorage.getItem("admin_password") || password;
    if (!savedPassword) {
      setLoading(false);
      setIsAuthenticated(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/stats?t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${savedPassword}`
        }
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        setAuthError("รหัสผ่านไม่ถูกต้อง");
        localStorage.removeItem("admin_password");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [password]);

  const handleLogin = (enteredVal: string) => {
    localStorage.setItem("admin_password", enteredVal);
    setPassword(enteredVal);
    setAuthError(null);
    setTimeout(() => {
      fetchStats();
    }, 50);
  };

  useEffect(() => {
    const saved = localStorage.getItem("admin_password");
    if (saved) {
      setPassword(saved);
      setIsAuthenticated(true);
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
      const interval = setInterval(fetchStats, 60000);
      return () => clearInterval(interval);
    }
  }, [fetchStats, isAuthenticated]);

  // ─── Helpers ──────────────────────────
  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("th-TH", { weekday: "short" });
  };

  // ─── Loading State ────────────────────
  if (loading) {
    return (
      <>
        <Navbar />
        <main className="container">
          <div className="loading-wrapper">
            <div className="loading-spinner" />
            <p className="loading-text">กำลังโหลดข้อมูล...</p>
          </div>
        </main>
      </>
    );
  }

  // ─── Password Gate State ────────────────
  if (!isAuthenticated) {
    return (
      <>
        <Navbar />
        <main className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "70vh" }}>
          <div style={{
            background: "#121318",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            padding: "40px 30px",
            maxWidth: "400px",
            width: "100%",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
            textAlign: "center"
          }}>
            <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔒</div>
            <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#ffffff", marginBottom: "10px" }}>
              ระบบควบคุมแอดมิน
            </h2>
            <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.6)", marginBottom: "24px" }}>
              กรุณากรอกรหัสผ่านเพื่อเข้าใช้งานระบบหลังบ้าน
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleLogin(enteredPassword);
            }}>
              <input
                type="password"
                placeholder="รหัสผ่านผู้ดูแลระบบ"
                value={enteredPassword}
                onChange={(e) => setEnteredPassword(e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                  outline: "none",
                  marginBottom: "16px",
                  textAlign: "center"
                }}
              />
              {authError && (
                <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "16px" }}>
                  {authError}
                </div>
              )}
              <button
                type="submit"
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                  color: "#ffffff",
                  border: "none",
                  padding: "12px",
                  borderRadius: "8px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                ยืนยันเข้าสู่ระบบ
              </button>
            </form>
          </div>
        </main>
      </>
    );
  }

  // ─── Error State ──────────────────────
  if (error && !stats) {
    return (
      <>
        <Navbar />
        <main className="container">
          <div className="error-wrapper">
            <div className="error-icon">⚠️</div>
            <h2 className="error-title">ไม่สามารถโหลดข้อมูลได้</h2>
            <p className="error-message">{error}</p>
            <button className="btn-retry" onClick={fetchStats}>
              ลองใหม่อีกครั้ง
            </button>
          </div>
        </main>
      </>
    );
  }

  if (!stats) return null;

  // ─── Chart data ───────────────────────
  const dailyEntries = Object.entries(stats.dailyCounts);
  const maxDaily = Math.max(...Object.values(stats.dailyCounts), 1);

  const subjectEntries = Object.entries(stats.subjectCounts).sort(
    (a, b) => b[1] - a[1]
  );
  const maxSubject = Math.max(...subjectEntries.map((e) => e[1]), 1);

  const answered = stats.totalQuizzesAnswered || 0;
  const correct = stats.totalQuizzesCorrect || 0;
  const incorrect = stats.totalQuizzesIncorrect || 0;
  const correctRate = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  return (
    <>
      <Navbar />

      <main className="container">
        {/* ─── Hero ───────────────────────────── */}
        <section className="hero">
          <div className="hero__badge">
            <span className="hero__badge-icon">🚔</span>
            ระบบเตรียมสอบนายสิบตำรวจ สายอำนวยการ
          </div>
          <h1 className="hero__title">
            <span className="hero__title-highlight">Police Quiz Bot</span>
          </h1>
          <p className="hero__description">
            ระบบส่งข้อสอบอัตโนมัติผ่าน Telegram Bot พร้อม AI
            ออกข้อสอบตามหลักสูตรจริง ครบทุกวิชา ทุกชั่วโมง
          </p>
        </section>

        {/* ─── Stats Cards ────────────────────── */}
        <section className="stats-grid" id="stats-overview">
          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--users">👥</div>
            <div className="stat-card__label">ผู้ใช้ทั้งหมด</div>
            <div className="stat-card__value stat-card__value--info">
              {stats.totalUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--active">✅</div>
            <div className="stat-card__label">กำลังใช้งาน</div>
            <div className="stat-card__value stat-card__value--success">
              {stats.awakeUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--sleep">😴</div>
            <div className="stat-card__label">โหมดพัก</div>
            <div className="stat-card__value stat-card__value--warning">
              {stats.sleepingUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--quiz">📝</div>
            <div className="stat-card__label">ข้อสอบที่ส่งแล้ว</div>
            <div className="stat-card__value stat-card__value--purple">
              {stats.totalQuizzesSent}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", border: "1px solid rgba(34, 197, 94, 0.2)" }}>🎯</div>
            <div className="stat-card__label">ทำแล้ว (ถูก / ผิด)</div>
            <div className="stat-card__value" style={{ color: "#ffffff", fontSize: "28px" }}>
              {answered} <span style={{ fontSize: "16px", color: "var(--text-muted)", fontWeight: "normal" }}>({correct} / {incorrect})</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.2)" }}>📈</div>
            <div className="stat-card__label">อัตราทำถูกเฉลี่ย</div>
            <div className="stat-card__value" style={{ color: "var(--warning)" }}>
              {correctRate}%
            </div>
          </div>
        </section>

        {/* ─── Charts Row ────────────────────── */}
        <section className="dashboard-grid" id="charts">
          {/* Daily Quiz Volume */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">📊 จำนวนข้อสอบ 7 วันย้อนหลัง</h2>
            </div>
            <div className="card__body">
              {dailyEntries.length > 0 ? (
                <div className="bar-chart">
                  {dailyEntries.map(([date, count]) => (
                    <div className="bar-chart__col" key={date}>
                      <span className="bar-chart__value">{count}</span>
                      <div
                        className="bar-chart__bar"
                        style={{
                          height: `${Math.max((count / maxDaily) * 100, 3)}%`,
                        }}
                      />
                      <span className="bar-chart__label">
                        {formatDay(date)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">ยังไม่มีข้อมูล</p>
                </div>
              )}
            </div>
          </div>

          {/* Subject Distribution */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">📚 การกระจายตัวของวิชา</h2>
            </div>
            <div className="card__body">
              {subjectEntries.length > 0 ? (
                <div className="subject-list">
                  {subjectEntries.map(([subject, count]) => (
                    <div className="subject-item" key={subject}>
                      <span className="subject-item__name">{subject}</span>
                      <div className="subject-item__bar-wrapper">
                        <div
                          className="subject-item__bar"
                          style={{
                            width: `${Math.max(
                              (count / maxSubject) * 100,
                              2
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="subject-item__count">{count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">ยังไม่มีข้อมูล</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Quiz Pool Section ──────────────── */}
        <section className="recent-section" id="quiz-pool" style={{ marginBottom: "2rem" }}>
          <div className="card">
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 className="card__title" style={{ fontSize: "1.25rem", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>📦</span> คลังข้อสอบส่วนกลาง (Global Quiz Pool)
                </h2>
                <p className="card__subtitle" style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.5)", marginTop: "4px" }}>
                  มีข้อสอบในคลังทั้งหมด <strong style={{ color: "#3b82f6" }}>{stats.totalQuizzesInPool || 0}</strong> ข้อ (ดึงส่งสอบรายชั่วโมงแบบไม่ซ้ำคนทำ)
                </p>
              </div>
            </div>
            <div className="card__body">
              {/* Subject counts in pool */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px", marginBottom: "20px" }}>
                {Object.entries(stats.subjectPoolCounts || {}).map(([sub, count]) => (
                  <div key={sub} style={{ background: "rgba(255, 255, 255, 0.02)", padding: "12px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                    <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.4)", marginBottom: "4px" }}>{sub}</div>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#ffffff" }}>
                      {count} <span style={{ fontSize: "12px", fontWeight: "normal", color: "rgba(255, 255, 255, 0.4)" }}>ข้อ</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action row to generate pool quizzes */}
              <div style={{ display: "flex", flexDirection: "column", gap: "15px", background: "rgba(255, 255, 255, 0.01)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
                {/* Row 1: Single Subject Generation */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "14px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>⚡ สั่ง AI ออกข้อสอบเพิ่มลงคลัง:</span>
                  <select
                    value={selectedPoolSubject}
                    onChange={(e) => setSelectedPoolSubject(e.target.value)}
                    disabled={generating || bulkGenerating}
                    style={{
                      background: "rgba(255, 255, 255, 0.05)",
                      color: "#ffffff",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      outline: "none"
                    }}
                  >
                    <option value="ความสามารถทั่วไป" style={{ background: "#111", color: "#fff" }}>ความสามารถทั่วไป</option>
                    <option value="ภาษาไทย" style={{ background: "#111", color: "#fff" }}>ภาษาไทย</option>
                    <option value="ภาษาอังกฤษ" style={{ background: "#111", color: "#fff" }}>ภาษาอังกฤษ</option>
                    <option value="คอมพิวเตอร์" style={{ background: "#111", color: "#fff" }}>คอมพิวเตอร์</option>
                    <option value="กฎหมาย" style={{ background: "#111", color: "#fff" }}>กฎหมาย</option>
                    <option value="สังคม" style={{ background: "#111", color: "#fff" }}>สังคม</option>
                    <option value="ระเบียบงานสารบรรณ" style={{ background: "#111", color: "#fff" }}>ระเบียบงานสารบรรณ</option>
                  </select>
                  <button
                    onClick={generatePoolQuizzes}
                    disabled={generating || bulkGenerating}
                    style={{
                      background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      opacity: (generating || bulkGenerating) ? 0.7 : 1
                    }}
                  >
                    {generating ? "กำลังออกข้อสอบ..." : "สั่ง AI ออกข้อสอบเฉพาะวิชา (+5 ข้อ)"}
                  </button>
                  {generationMsg && (
                    <span style={{ fontSize: "14px", marginLeft: "10px", color: generationMsg.includes("สำเร็จ") ? "#10b981" : "#ef4444" }}>{generationMsg}</span>
                  )}
                </div>

                {/* Row 2: Bulk All Subjects Generation */}
                <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "14px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>🔥 เจนข้อสอบครั้งใหญ่:</span>
                  <button
                    onClick={generateBulkQuizzes}
                    disabled={generating || bulkGenerating}
                    style={{
                      background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      opacity: (generating || bulkGenerating) ? 0.7 : 1
                    }}
                  >
                    {bulkGenerating ? "กำลังรันระบบ..." : "สั่ง AI ออกข้อสอบเพิ่มทุกวิชา (วิชาละ +50 ข้อ)"}
                  </button>
                </div>

                {/* Progress Bar for Bulk Generation */}
                {bulkStatusText && (
                  <div style={{ marginTop: "5px", background: "rgba(255, 255, 255, 0.02)", padding: "12px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                      <span style={{ color: "#d4d4d4" }}>{bulkStatusText}</span>
                      {bulkGenerating && <span style={{ fontWeight: "bold", color: "#10b981" }}>{bulkProgress}%</span>}
                    </div>
                    <div style={{ width: "100%", height: "8px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "4px", overflow: "hidden" }}>
                      <div 
                        style={{ 
                          width: `${bulkProgress}%`, 
                          height: "100%", 
                          background: "linear-gradient(90deg, #3b82f6, #10b981)", 
                          borderRadius: "4px",
                          transition: "width 0.4s ease"
                        }} 
                      />
                    </div>
                  </div>
                )}

                {/* Row 3: Recheck Pool */}
                <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "14px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>🔍 ตรวจสอบเฉลย:</span>
                  <button
                    onClick={startRecheckPool}
                    disabled={recheckRunning || generating || bulkGenerating}
                    style={{
                      background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      opacity: (recheckRunning || generating || bulkGenerating) ? 0.7 : 1
                    }}
                  >
                    {recheckRunning ? "กำลังตรวจสอบ..." : "Recheck เฉลยทั้งคลัง (AI ตรวจทุกข้อ)"}
                  </button>
                </div>

                {/* Progress Bar for Recheck */}
                {recheckStatusText && (
                  <div style={{ marginTop: "5px", background: "rgba(255, 255, 255, 0.02)", padding: "12px 15px", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.15)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                      <span style={{ color: "#d4d4d4" }}>{recheckStatusText}</span>
                      {recheckRunning && <span style={{ fontWeight: "bold", color: "#f59e0b" }}>{recheckProgress}%</span>}
                    </div>
                    <div style={{ width: "100%", height: "8px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "4px", overflow: "hidden" }}>
                      <div 
                        style={{ 
                          width: `${recheckProgress}%`, 
                          height: "100%", 
                          background: "linear-gradient(90deg, #f59e0b, #ef4444)", 
                          borderRadius: "4px",
                          transition: "width 0.4s ease"
                        }} 
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Recent Quizzes ────────────────── */}
        <section className="recent-section" id="recent-quizzes">
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">🕐 ข้อสอบล่าสุด</h2>
            </div>
            <div className="card__body">
              {stats.recentQuizzes.length > 0 ? (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>เวลา</th>
                        <th>วิชา</th>
                        <th>คำถาม</th>
                        <th>เฉลย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentQuizzes.map((quiz) => (
                        <tr key={quiz.id}>
                          <td>
                            <span className="time-text">
                              {formatDate(quiz.sentAt)}
                            </span>
                          </td>
                          <td>
                            <span className="tag">{quiz.subject}</span>
                          </td>
                          <td>
                            <span className="question-text">
                              {quiz.question}
                            </span>
                          </td>
                          <td>{quiz.correctAnswer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">
                    ยังไม่มีข้อสอบที่ส่ง — เมื่อ Cron ทำงาน ข้อมูลจะปรากฏที่นี่
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Features ──────────────────────── */}
        <section className="features-grid" id="features">
          <div className="feature-card">
            <div className="feature-card__icon">🤖</div>
            <h3 className="feature-card__title">AI ออกข้อสอบ</h3>
            <p className="feature-card__desc">
              ใช้ OpenAI GPT-4o-mini ออกข้อสอบใหม่ทุกครั้ง
              ไม่มีซ้ำ ตรงหลักสูตรจริง
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-card__icon">⏰</div>
            <h3 className="feature-card__title">ส่งทุกชั่วโมง</h3>
            <p className="feature-card__desc">
              GitHub Actions ทริกเกอร์ทุกชั่วโมง ส่งข้อสอบอัตโนมัติ
              ไม่ต้องเปิดแอป
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-card__icon">📱</div>
            <h3 className="feature-card__title">ตอบผ่าน Telegram</h3>
            <p className="feature-card__desc">
              รับข้อสอบแบบ Quiz Poll พร้อมคำใบ้และเฉลยอัตโนมัติ
              สะดวกทุกที่
            </p>
          </div>
        </section>
      </main>

      {/* ─── Footer ──────────────────────── */}
      <footer className="footer">
        <div className="container">
          <p className="footer__text">
            © 2026 Police Quiz Bot — ระบบเตรียมสอบนายสิบตำรวจ สายอำนวยการ
          </p>
        </div>
      </footer>

      {/* ─── Bulk Confirm Modal ────────────────── */}
      {showBulkConfirm && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          backdropFilter: "blur(6px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: "#121318",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            padding: "30px 25px",
            maxWidth: "420px",
            width: "90%",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
            textAlign: "center"
          }}>
            <div style={{ fontSize: "40px", marginBottom: "15px" }}>🔥</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", color: "#ffffff", marginBottom: "10px" }}>
              ยืนยันการออกข้อสอบชุดใหญ่
            </h3>
            <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.6)", lineHeight: "1.6", marginBottom: "24px" }}>
              คุณต้องการสั่งให้ AI ออกข้อสอบเพิ่มทุกวิชา วิชาละ 50 ข้อใช่หรือไม่?<br/>
              <span style={{ color: "#3b82f6", display: "block", marginTop: "8px", fontWeight: "500" }}>
                * ระบบจะทำงานทั้งหมด 35 รอบ รอบละ 10 ข้อ (รวมเป็น 350 ข้อ) เพื่อความปลอดภัยและคัดกรองโจทย์ซ้ำโดยสมบูรณ์
              </span>
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                onClick={() => {
                  setShowBulkConfirm(false);
                  startBulkGeneration();
                }}
                style={{
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                ยืนยันเริ่มออกข้อสอบ
              </button>
              <button
                onClick={() => setShowBulkConfirm(false)}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════
   Navbar Component (inline)
   ═══════════════════════════════════════ */

function Navbar() {
  return (
    <nav className="navbar">
      <div className="container navbar__inner">
        <a href="/" className="navbar__brand">
          <img src="/logo.png" alt="Logo" className="navbar__logo" />
          <div>
            <div className="navbar__title">Police Quiz Bot</div>
            <div className="navbar__subtitle">Dashboard</div>
          </div>
        </a>
        <div className="navbar__actions">
          <div className="navbar__status">
            <span className="navbar__status-dot" />
            System Online
          </div>
        </div>
      </div>
    </nav>
  );
}
