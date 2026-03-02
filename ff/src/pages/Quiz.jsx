import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { Clock } from 'lucide-react';

const Quiz = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [timeLeft, setTimeLeft] = useState(0);
    const [sessionId, setSessionId] = useState(null);
    const [error, setError] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [stats, setStats] = useState({ correct: 0, total: 0 });

    // Timer Ref
    const timerRef = useRef(null);

    // Start Quiz
    useEffect(() => {
        client.post('/quiz/start')
            .then(res => {
                setSessionId(res.data.session_id);
                // Save anon code for anti-repeat check
                if (res.data.anon_code) {
                    localStorage.setItem('quiz_anon_code', res.data.anon_code);
                }
                if (res.data.first_question) {
                    setQuestion(res.data.first_question);
                } else {
                    setError("無法取得題目");
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError("無法啟動測驗，請稍後再試。");
                setLoading(false);
            });

        return () => clearInterval(timerRef.current);
    }, []);

    const setQuestion = (qMeta) => {
        setCurrentQuestion(qMeta);
        setTimeLeft(qMeta.time_limit);
        setProcessing(false);
    };

    // Timer Logic
    useEffect(() => {
        if (loading || !currentQuestion || processing) return;

        // Clear previous
        clearInterval(timerRef.current);

        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    handleTimeout();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timerRef.current);
    }, [currentQuestion, loading, processing]);

    const handleTimeout = () => {
        clearInterval(timerRef.current);
        handleAnswer(-1, true);
    };

    const handleAnswer = (selectedOptionIndex, isTimeout = false) => {
        if (processing) return;
        setProcessing(true);
        clearInterval(timerRef.current);

        const q = currentQuestion;
        const timeUsed = q.time_limit - (isTimeout ? 0 : timeLeft);

        client.post('/quiz/answer', {
            session_id: sessionId,
            question_id: q.id,
            selected_option: isTimeout ? -1 : selectedOptionIndex,
            time_used: timeUsed
        }).then(res => {
            if (res.data.message) {
                // For example "Cheating detected"
                console.log(res.data.message);
            }

            const data = res.data;
            const correctOpt = data.correct_option !== undefined ? data.correct_option : selectedOptionIndex;

            // Set visual feedback immediately
            setFeedback({
                selected: isTimeout ? -1 : selectedOptionIndex,
                correctOption: correctOpt,
                isCorrect: data.correct
            });

            if (data.correct !== undefined) {
                setStats(prev => ({
                    correct: prev.correct + (data.correct ? 1 : 0),
                    total: prev.total + 1
                }));
            }

            // Wait 800ms before progressing
            setTimeout(() => {
                setFeedback(null);
                if (data.finished) {
                    // Submit final
                    client.post('/quiz/submit', { session_id: sessionId })
                        .then(finalRes => {
                            navigate('/result', { state: finalRes.data });
                        });
                } else if (data.next_question) {
                    setQuestion(data.next_question);
                } else {
                    // Fallback catch
                    setError("測驗異常終止");
                }
            }, 800);
        })
            .catch(err => {
                console.error(err);
                setError("連線錯誤");
                setProcessing(false);
            });
    };

    if (loading) return <div className="flex h-screen items-center justify-center font-bold text-gray-500">載入中...</div>;
    if (error) return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;
    if (!currentQuestion) return null;

    const q = currentQuestion;
    // index is 0-based, so +1. Total is 20.
    const progress = ((q.current_index + 1) / 20) * 100;

    return (
        <div className="min-h-screen bg-light flex flex-col items-center justify-start pt-10 px-4">
            {/* Header / Timer */}
            <div className="w-full max-w-2xl flex justify-between items-center mb-2">
                <div className="text-xl font-bold text-gray-700">
                    Question <span className="text-secondary">{q.current_index + 1}</span>
                    <span className="text-gray-400 text-sm">/20</span>
                </div>
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-lg font-bold ${timeLeft < 5 ? 'bg-red-100 text-red-500 animate-pulse' : 'bg-indigo-100 text-primary'}`}>
                    <Clock size={20} />
                    {timeLeft}s
                </div>
            </div>

            {/* Difficulty and Accuracy */}
            <div className="w-full max-w-2xl flex items-center gap-2 mb-4 text-sm font-medium text-gray-500">
                <span>目前難度：</span>
                {(() => {
                    let difLabel = "中等";
                    let difClass = "bg-yellow-100 text-yellow-700";
                    if (q.difficulty !== undefined) {
                        if (q.difficulty <= 0.2) { difLabel = "入門"; difClass = "bg-green-100 text-teal-700"; }
                        else if (q.difficulty <= 0.4) { difLabel = "簡單"; difClass = "bg-green-100 text-green-700"; }
                        else if (q.difficulty <= 0.6) { difLabel = "中等"; difClass = "bg-yellow-100 text-yellow-700"; }
                        else if (q.difficulty <= 0.8) { difLabel = "困難"; difClass = "bg-red-100 text-red-700"; }
                        else { difLabel = "挑戰"; difClass = "bg-red-200 text-red-800"; }
                    }
                    return <span className={`px-3 py-1 rounded-full font-bold ${difClass}`}>{difLabel}</span>;
                })()}
                <span className="ml-2">（正確率: {stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0}%）</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-2xl h-2 bg-gray-200 rounded-full mb-8 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>

            {/* Question Card */}
            <div className={`w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 relative ${processing ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Image */}
                <div className="w-full bg-gray-50 flex items-center justify-center p-4 min-h-[300px] relative">
                    {q.category && (
                        <div className="absolute top-4 left-4 bg-gradient-to-r from-primary to-accent text-white px-4 py-1 rounded-full text-sm font-bold shadow-md z-10">
                            {q.category}
                        </div>
                    )}
                    <img
                        src={`/api/questions/${q.id}/image`}
                        alt="Question"
                        className="max-w-full h-auto rounded shadow-sm"
                        key={q.id}
                    />
                </div>

                {/* Options */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[0, 1, 2, 3].map((idx) => {
                        let btnClass = "p-4 rounded-xl border-2 text-left transition-all duration-200 group relative overflow-hidden bg-white ";
                        let iconClass = "absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center font-bold transition-colors ";

                        if (feedback) {
                            if (idx === feedback.correctOption) {
                                btnClass += "border-green-500 bg-green-50";
                                iconClass += "bg-green-500 text-white";
                            } else if (idx === feedback.selected && !feedback.isCorrect) {
                                btnClass += "border-red-500 bg-red-50";
                                iconClass += "bg-red-500 text-white";
                            } else {
                                btnClass += "border-gray-100 opacity-60";
                                iconClass += "bg-gray-100 text-gray-500";
                            }
                        } else {
                            btnClass += "border-gray-100 hover:border-primary hover:bg-indigo-50";
                            iconClass += "bg-gray-100 text-gray-500 group-hover:bg-primary group-hover:text-white";
                        }

                        return (
                            <button
                                key={idx}
                                onClick={() => handleAnswer(idx)}
                                disabled={processing}
                                className={btnClass}
                            >
                                <span className={iconClass}>
                                    {String.fromCharCode(65 + idx)}
                                </span>
                                <span className="ml-10 text-gray-700 font-medium">
                                    {(q.options && q.options[idx]) ? q.options[idx] : `選項 ${String.fromCharCode(65 + idx)}`}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Hint Button (Optional) */}
            <div className="mt-8">
                <button className="text-gray-400 text-sm hover:text-gray-600 underline">
                    需要提示嗎？(扣分)
                </button>
            </div>
        </div>
    );
};

export default Quiz;
